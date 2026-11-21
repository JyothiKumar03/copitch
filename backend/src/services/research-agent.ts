import { tool } from "ai";
import { z } from "zod";
import type { TToolProviders } from "../types/ai";
import type { TCollectResearch, TResearchAgentState } from "../types/research-agent";
import { research_agent } from "./prompts";
import { SessionRunner } from "./session-runner";

export type { TResearchAgentState } from "../types/research-agent";

const research_budget = {
  lookups_per_pass: 10, passes: 2, duration_ms: 150_000, lookup_timeout_ms: 20_000, tokens: 120_000, usd: 0.35,
  targets: 120, hits_per_read: 20, retained_history_chars: 24_000, assessment_chars: 3_200, completion_reminders: 2,
};
const broad_public_page_guide = 10;
const counted_pages = (state: TResearchAgentState) => new Set(state.targets.flatMap(target =>
  target.kind === "read" && target.evidence_ids?.length ? [target.canonical_url ?? target.value] : [])).size;
const pending_seeds = (state: TResearchAgentState) => state.targets.filter(target => target.seed && !target.status);

const notes = z.string().trim().min(1).max(1_600);
const research_assessment = z.discriminatedUnion("decision", [
  z.strictObject({ decision: z.literal("complete"), notes }),
  z.strictObject({ decision: z.literal("continue"), notes, gap: z.string().trim().min(1).max(420),
    reason: z.string().trim().min(1).max(500), target_id: z.string().max(20), tool: z.enum(["read_url", "web_search"]) }),
]);

const parse_assessment = (text: string) => {
  try { return research_assessment.safeParse(JSON.parse(text)).data; }
  catch { return undefined; }
};

const initial_state = ({ brief, evidence, gaps, previous }: TCollectResearch): TResearchAgentState => {
  const targets: TResearchAgentState["targets"] = [];
  if (brief.source_policy === "public_search") {
    for (const url of new Set(brief.urls)) {
      targets.push({ id: "S" + (targets.length + 1), kind: "read", value: url, label: url, seed: true });
    }
    for (const query of new Set(brief.public_queries)) {
      targets.push({ id: "S" + (targets.length + 1), kind: "search", value: query, label: query });
    }
  }
  const prior = previous?.brief_id === brief.brief_id ? structuredClone(previous) : undefined;
  // Preserve retrieved records and budget from older checkpoints, while rebuilding the model context.
  const steps = prior ? Math.max(prior.steps, prior.lookup_attempts) : 0;
  return {
    version: 3, brief_id: brief.brief_id, started_at: prior?.started_at ?? Date.now(),
    steps, pass: 1, pass_steps: Math.min(steps, research_budget.lookups_per_pass),
    completed_lookups: prior?.completed_lookups ?? 0, lookup_attempts: prior?.lookup_attempts ?? 0,
    model_attempts: prior?.model_attempts ?? [], messages: [], targets: prior?.targets ?? targets,
    evidence: [...evidence], gaps: [...gaps],
    stop_reason: prior?.stop_reason === "finished" || prior?.stop_reason === "budget" ? prior.stop_reason : undefined,
  };
};

const within_usage_budget = (state: TResearchAgentState) => {
  const usage = state.model_attempts.reduce((total, attempt) => ({
    tokens: total.tokens + (attempt.usage?.input_tokens ?? 0) + (attempt.usage?.output_tokens ?? 0),
    usd: total.usd + (attempt.estimated_usd ?? 0),
  }), { tokens: 0, usd: 0 });
  return usage.tokens < research_budget.tokens && usage.usd < research_budget.usd;
};

const research_tools = (
  input: TCollectResearch, state: TResearchAgentState, signal: AbortSignal, persist: () => void,
) => {
  const by_id = new Map(state.evidence.map(item => [item.id, item]));
  const seen_passages = new Set(state.evidence.filter(item => item.url).map(item => item.url + "\n" + item.passage));
  let reserved_step = 0;
  const target_result = (target: TResearchAgentState["targets"][number]) => ({
    status: target.status,
    ...(target.kind === "read" && { url: target.canonical_url ?? target.value }),
    evidence: target.evidence_ids?.flatMap(id => {
      const item = by_id.get(id);
      return item ? [{ id, location: item.location, excerpt: item.passage.slice(0, 800) }] : [];
    }),
    links: target.discovered_ids?.slice(0, 24).flatMap(id => {
      const link = state.targets.find(item => item.id === id);
      return link ? [{ source_id: id, url: link.value, label: link.label }] : [];
    }),
  });
  const ensure_owner = () => {
    input.signal.throwIfAborted();
    signal.throwIfAborted();
    input.check_current();
  };

  const look_up = async (id: string, kind: "read" | "search") => {
    ensure_owner();
    if (reserved_step === state.steps) return { error: "Choose one lookup per research step." };
    if (state.pass_steps > research_budget.lookups_per_pass ||
        state.lookup_attempts >= research_budget.passes * research_budget.lookups_per_pass) return { error: "The lookup limit was reached." };
    reserved_step = state.steps;
    const target = state.targets.find(item => item.id === id && item.kind === kind);
    state.lookup_attempts++;
    if (target) target.attempted = true;
    persist();

    if (input.brief.source_policy !== "public_search" || !target) return { error: "Use a source or query ID from the approved research context." };
    if (target.status) return target_result(target);

    input.activity?.("lookup_requested", kind === "read" ? "Requested an eligible source." : "Requested an approved public search.");
    let result;
    try {
      const lookup_signal = AbortSignal.any([signal, AbortSignal.timeout(research_budget.lookup_timeout_ms)]);
      result = await input.lookup({
        kind, target: target.value, known_links: state.targets.filter(item => item.kind === "read" && !item.seed).map(item => item.value),
      }, lookup_signal);
    } catch {
      // An interrupted or superseded run keeps its reservation and can resume only from the last durable result.
      ensure_owner();
      target.status = "failed";
      state.completed_lookups++;
      persist();
      input.activity?.("lookup_failed", "An eligible source could not be retrieved.");
      return target_result(target);
    }
    ensure_owner();

    const { hits, links, url } = result;
    if (kind === "read") target.canonical_url = url ?? hits[0]?.url ?? target.value;
    target.discovered_ids = [];
    for (const link of links ?? []) {
      const existing = state.targets.find(item => item.kind === "read" && item.value === link.url);
      if (existing) {
        if (existing.id !== id) target.discovered_ids.push(existing.id);
        continue;
      }
      if (state.targets.length >= research_budget.targets) break;
      const entry = { id: "S" + (state.targets.length + 1), kind: "read" as const,
        value: link.url, label: link.title.trim().slice(0, 180) || link.url };
      state.targets.push(entry);
      target.discovered_ids.push(entry.id);
    }
    target.evidence_ids = [];
    // Public search offers candidate URLs. Only a page read can add public evidence.
    for (const hit of kind === "read" ? hits.slice(0, research_budget.hits_per_read) : []) {
      const passage = hit.passage.trim().slice(0, 1800);
      const key = hit.url + "\n" + passage;
      if (!passage || seen_passages.has(key)) continue;
      const item = { id: "P" + (state.evidence.length + 1), origin: "public" as const, location: hit.title.slice(0, 200),
        url: hit.url, passage };
      seen_passages.add(key);
      by_id.set(item.id, item);
      state.evidence.push(item);
      target.evidence_ids.push(item.id);
    }
    target.status = target.evidence_ids.length > 0 || target.discovered_ids.length > 0 ? "read" : "empty";
    state.completed_lookups++;
    persist();
    input.activity?.(target.status === "empty" ? "lookup_empty" : kind === "read" ? "page_opened" : "search_completed",
      target.status === "empty" ? "The lookup added no new support." : kind === "read"
        ? "Opened an eligible source." : "Public search returned candidate sources.");
    if (target.evidence_ids.length) input.activity?.("sources_saved", `Saved ${target.evidence_ids.length} cited source records.`);
    return target_result(target);
  };

  const registry: TToolProviders = { session: {
    read_url: tool({
      description: "Read a host-approved URL or a URL discovered by research. Returns its canonical URL, evidence with source IDs, and eligible links to follow. Supply a source_id from the current source list or a prior result.",
      inputSchema: z.object({ source_id: z.string().max(20) }),
      execute: ({ source_id }) => look_up(source_id, "read"),
    }),
    ...(input.brief.public_queries.length > 0 && { web_search: tool({
      description: "Run a public search from the approved brief to discover source URLs. Supply an approved query_id. Read a result with read_url before citing it.",
      inputSchema: z.object({ query_id: z.string().max(20) }),
      execute: ({ query_id }) => look_up(query_id, "search"),
    }) }),
  } };
  return registry;
};

const selected_context = (input: TCollectResearch, state: TResearchAgentState, assessment_only: boolean, completion_reminder?: string) => {
  const targets = state.targets.filter(target => !target.status);
  return JSON.stringify({
    as_of: new Date().toISOString().slice(0, 10),
    goal: { summary: input.brief.summary.slice(0, 3600), intent: input.brief.intent, source_policy: input.brief.source_policy },
    confirmed_intake_context: input.brief.messages.slice(-6).map(message => message.slice(0, 660)),
    pass: state.pass,
    page_coverage: { pages_read: state.read_pages, broad_public_guide: broad_public_page_guide },
    extra_pass_available: state.pass < research_budget.passes,
    remaining_lookups: assessment_only ? 0 : research_budget.lookups_per_pass - state.pass_steps + 1,
    continuation: state.continuation,
    completion_reminder,
    eligible_sources: targets.filter(item => item.kind === "read").slice(0, 80)
      .map(({ id, label, seed, value }) => ({ source_id: id, label, url: value, host_approved: seed })),
    approved_queries: targets.filter(item => item.kind === "search").map(({ id, label }) => ({ query_id: id, query: label })),
    evidence: [...state.evidence.slice(0, 12), ...state.evidence.slice(Math.max(12, state.evidence.length - 46))]
      .map(({ id, location, passage, origin }) => ({ id, location: location.slice(0, 150), origin, preview: passage.slice(0, 220) })),
    considered_sources: state.targets.filter(target => target.status).map(({ id, label, status, canonical_url }) =>
      ({ id, label, status, url: canonical_url })),
  });
};

export const collect_research = async (input: TCollectResearch): Promise<TResearchAgentState> => {
  const prior = input.previous;
  const state = prior?.version === 3 && prior.brief_id === input.brief.brief_id ? structuredClone(prior) : initial_state(input);
  state.read_pages = counted_pages(state);
  input.signal.throwIfAborted();
  input.check_current();
  if (state.stop_reason) return state;
  const persist = () => {
    input.check_current();
    state.read_pages = counted_pages(state);
    input.checkpoint?.(structuredClone(state));
  };
  const finish = (reason: NonNullable<TResearchAgentState["stop_reason"]>) => {
    const gaps = new Set(state.gaps);
    for (const target of state.targets) {
      if (target.seed && (target.status === "failed" || target.status === "empty")) gaps.add("No readable evidence for " + target.label + ".");
    }
    for (const target of pending_seeds(state)) gaps.add("The approved source was not read: " + target.label + ".");
    if (reason === "budget") gaps.add("Research reached its discovery limit. The brief uses the evidence available so far.");
    state.stop_reason = reason;
    state.gaps = [...gaps];
    persist();
  };
  if (input.brief.source_policy === "files_only" || !state.targets.length) {
    finish("finished");
    return state;
  }
  const remaining_ms = state.started_at + research_budget.duration_ms - Date.now();
  const deadline = AbortSignal.timeout(Math.max(1, remaining_ms));
  const signal = AbortSignal.any([input.signal, deadline]);
  const registry = research_tools(input, state, signal, persist);
  let latest_assessment = "";
  let completion_reminder: string | undefined;
  let reminders = 0;
  try {
    if (remaining_ms > 0) await SessionRunner.run_steps(input.model_step, {
      completed_steps: state.steps, max_steps: research_budget.passes * (research_budget.lookups_per_pass + 1),
      select_step: step => {
        if (deadline.aborted || !within_usage_budget(state) || state.pass_steps > research_budget.lookups_per_pass) return;
        const assessment_only = state.pass_steps === research_budget.lookups_per_pass ||
          state.targets.every(target => !!target.status);
        // One model turn is reserved before dispatch, including turns with malformed tool arguments.
        state.steps = step;
        state.pass_steps++;
        latest_assessment = "";
        persist();
        return {
          instructions: research_agent, ephemeral: true, parallel_tool_calls: false,
          messages: [...(assessment_only ? [] : state.messages), { role: "user", content: selected_context(input, state, assessment_only, completion_reminder) }],
          tool_providers: assessment_only ? {} : registry, signal,
          on_text: text => { latest_assessment = (latest_assessment + text).slice(0, research_budget.assessment_chars); },
          on_attempt: attempt => { state.model_attempts.push(attempt); persist(); },
        };
      },
      checkpoint: (_step, result) => {
        state.messages = JSON.stringify(result.messages).length <= research_budget.retained_history_chars ? result.messages : [];
        if (!result.continue_with_tools) {
          const assessment = parse_assessment(latest_assessment);
          if (assessment) state.research_notes = assessment.notes;
          if (assessment?.decision === "continue") {
            const { gap, reason, tool, target_id } = assessment;
            const target = state.targets.find(item => item.id === target_id && !item.status && !item.attempted &&
              item.kind === (tool === "read_url" ? "read" : "search"));
            const eligible = target && !state.targets.some(item => item.status && item.canonical_url === target.value);
            if (eligible && state.pass === 1 && !deadline.aborted && within_usage_budget(state)) {
              state.pass = 2;
              state.pass_steps = 0;
              state.continuation = { gap, reason, tool, target_id };
              persist();
              input.activity?.("lookup_requested", "Started a second research pass for an outstanding part of the brief.");
              return false;
            }
            if (eligible && (state.pass === 2 || deadline.aborted || !within_usage_budget(state))) {
              finish("budget");
              return true;
            }
          }
          const unread = pending_seeds(state);
          if (unread.length || !state.lookup_attempts) {
            if (state.pass_steps < research_budget.lookups_per_pass && reminders < research_budget.completion_reminders &&
                !deadline.aborted && within_usage_budget(state)) {
              reminders++;
              completion_reminder = unread.length
                ? "Attempt the outstanding host-approved reads before finishing: " + unread.map(source => source.id).join(", ") + "."
                : "The approved public research has no attempted lookup. Select an eligible search or page read.";
              state.messages = [];
              persist();
              return false;
            }
            finish("budget");
            return true;
          }
          finish("finished");
          return true;
        }
        completion_reminder = undefined;
        persist();
        return false;
      },
    });
  } catch (error) {
    input.signal.throwIfAborted();
    input.check_current();
    if (!deadline.aborted) throw error;
  }
  input.signal.throwIfAborted();
  if (!state.stop_reason) finish("budget");
  return state;
};
