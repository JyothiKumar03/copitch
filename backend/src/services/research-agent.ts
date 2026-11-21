import { tool } from "ai";
import { z } from "zod";
import type { TToolProviders } from "../types/ai";
import type { TCollectResearch, TCoverageItem, TResearchAgentState } from "../types/research-agent";
import { numbers_stated_in, quotes } from "./excerpt";
import { research_agent } from "./prompts";
import { SessionRunner } from "./session-runner";

export type { TResearchAgentState } from "../types/research-agent";

// The agent works a coverage checklist: it plans the questions the brief must answer, searches and reads in parallel
// batches, and records an answer only with a verbatim excerpt the server can check. Budgets bound the worst case.
export const research_budget = {
  lookups: 32, lookups_per_step: 8, searches_per_call: 4, reads_per_call: 4, steps: 18,
  duration_ms: 240_000, lookup_timeout_ms: 40_000, tokens: 400_000, usd: 0.8,
  targets: 160, hits_per_read: 20, result_passages: 10, retained_history_chars: 60_000, reminders: 3,
  checklist_max: 10, tries_before_unavailable: 2,
};

// Depth follows what the host gave. Their own site or files are read and summarized; only an open question gets a web hunt.
export type TResearchMode = "focused" | "broad";
export const research_mode = (input: Pick<TCollectResearch, "brief" | "evidence">): TResearchMode =>
  input.brief.urls.length || input.evidence.some(item => item.origin === "material") ? "focused" : "broad";
const mode_limits = {
  focused: { lookups: 12, steps: 8, checklist_max: 6, tries: 1 },
  broad: { lookups: research_budget.lookups, steps: research_budget.steps, checklist_max: research_budget.checklist_max, tries: research_budget.tries_before_unavailable },
};

const counted_pages = (state: TResearchAgentState) => new Set(state.targets.flatMap(target =>
  target.kind === "read" && target.evidence_ids?.length ? [target.canonical_url ?? target.value] : [])).size;
const pending_seeds = (state: TResearchAgentState) => state.targets.filter(target => target.seed && !target.status);
const open_items = (state: TResearchAgentState) => state.checklist.filter(item => item.status === "open");
const has_digit = (text: string) => [...text].some(character => character >= "0" && character <= "9");
// Sources often spell quantities out ("twelve teams", "two lakh tonnes"), which still answer a number question.
const number_words = new Set(["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
  "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty", "thirty", "forty", "fifty",
  "sixty", "seventy", "eighty", "ninety", "hundred", "thousand", "million", "billion", "trillion", "lakh", "crore", "dozen", "half"]);
const states_number = (text: string) => has_digit(text) ||
  text.toLowerCase().split(" ").some(word => number_words.has([...word].filter(character => character >= "a" && character <= "z").join("")));
const query_key = (query: string) => query.toLowerCase().split(" ").filter(Boolean).join(" ");
const words = (text: string) => [...text.toLowerCase()].map(character =>
  (character >= "a" && character <= "z") || (character >= "0" && character <= "9") || character > "\u007f" ? character : " ")
  .join("").split(" ").filter(word => word.length >= 4);

// A long report yields hundreds of passages. Keep those that share the most terms with the question, preferring figures.
const rank_passages = <T extends { passage: string }>(hits: T[], focus: string) => {
  const terms = new Set(words(focus));
  if (!terms.size) return hits;
  const score = (passage: string) => {
    const present = new Set(words(passage).filter(word => terms.has(word))).size;
    return present * 2 + (has_digit(passage) ? 1 : 0);
  };
  return hits.map((hit, index) => ({ hit, index, score: score(hit.passage) }))
    .sort((a, b) => b.score - a.score || a.index - b.index).map(entry => entry.hit);
};

const initial_state = ({ brief, evidence, gaps, previous }: TCollectResearch): TResearchAgentState => {
  const prior = previous?.brief_id === brief.brief_id ? structuredClone(previous) : undefined;
  const targets: TResearchAgentState["targets"] = prior?.targets ?? [];
  if (!prior && brief.source_policy === "public_search") {
    for (const url of new Set(brief.urls)) {
      targets.push({ id: "S" + (targets.length + 1), kind: "read", value: url, label: url, seed: true });
    }
  }
  return {
    version: 4, brief_id: brief.brief_id, started_at: prior?.started_at ?? Date.now(),
    steps: prior?.steps ?? 0, pass: prior?.pass ?? 0,
    completed_lookups: prior?.completed_lookups ?? 0, lookup_attempts: prior?.lookup_attempts ?? 0,
    model_attempts: prior?.model_attempts ?? [], messages: [], targets, checklist: [],
    evidence: [...evidence], gaps: [...gaps],
  };
};

const within_usage_budget = (state: TResearchAgentState) => {
  const usage = state.model_attempts.reduce((total, attempt) => ({
    tokens: total.tokens + (attempt.usage?.input_tokens ?? 0) + (attempt.usage?.output_tokens ?? 0),
    usd: total.usd + (attempt.estimated_usd ?? 0),
  }), { tokens: 0, usd: 0 });
  return usage.tokens < research_budget.tokens && usage.usd < research_budget.usd;
};

const coverage_view = (item: TCoverageItem) => ({
  item_id: item.id, question: item.question, needs: item.needs, status: item.status, lookups: item.lookups,
  ...(item.answer && { answer: item.answer, evidence_id: item.evidence_id }), ...(item.reason && { reason: item.reason }),
});

const research_tools = (
  input: TCollectResearch, state: TResearchAgentState, signal: AbortSignal, persist: () => void,
) => {
  const limits = mode_limits[research_mode(input)];
  const by_id = new Map(state.evidence.map(item => [item.id, item]));
  const seen_passages = new Set(state.evidence.filter(item => item.url).map(item => item.url + "\n" + item.passage));
  const step_lookups = new Map<number, number>();
  const item_of = (id: string | undefined) => state.checklist.find(item => item.id === id);
  const target_result = (target: TResearchAgentState["targets"][number]) => ({
    source_id: target.id, status: target.status,
    ...(target.kind === "read" ? { url: target.canonical_url ?? target.value } : { query: target.value }),
    evidence: target.evidence_ids?.slice(0, research_budget.result_passages).flatMap(id => {
      const item = by_id.get(id);
      return item ? [{ evidence_id: id, location: item.location, passage: item.passage.slice(0, 900) }] : [];
    }),
    links: target.discovered_ids?.slice(0, 12).flatMap(id => {
      const link = state.targets.find(item => item.id === id);
      return link ? [{ source_id: id, url: link.value, label: link.label }] : [];
    }),
  });
  const ensure_owner = () => {
    input.signal.throwIfAborted();
    signal.throwIfAborted();
    input.check_current();
  };
  // Reserve budget synchronously so parallel calls in one step cannot overspend it.
  const reserve = () => {
    const used = step_lookups.get(state.steps) ?? 0;
    if (state.lookup_attempts >= limits.lookups) return "The research lookup budget is used up. Record answers or mark items unavailable.";
    if (used >= research_budget.lookups_per_step) return "Too many lookups in one step. Continue in the next step.";
    step_lookups.set(state.steps, used + 1);
    state.lookup_attempts++;
    return undefined;
  };

  const look_up = async (target: TResearchAgentState["targets"][number]) => {
    target.attempted = true;
    persist();
    const searching = target.kind === "search";
    input.activity?.("lookup_requested", searching ? `Searched: “${target.value}”` : "Opened: " + target.value);
    let result;
    try {
      const lookup_signal = AbortSignal.any([signal, AbortSignal.timeout(research_budget.lookup_timeout_ms)]);
      result = await input.lookup({
        kind: target.kind, target: target.value,
        known_links: state.targets.filter(item => item.kind === "read" && !item.seed).map(item => item.value),
      }, lookup_signal);
    } catch {
      ensure_owner();
      target.status = "failed";
      state.completed_lookups++;
      persist();
      input.activity?.("lookup_failed", (searching ? "Search failed: " : "Could not read: ") + target.value);
      return target_result(target);
    }
    ensure_owner();
    const { hits, links, url } = result;
    if (!searching) target.canonical_url = url ?? hits[0]?.url ?? target.value;
    target.discovered_ids = [];
    for (const link of links ?? []) {
      const existing = state.targets.find(item => item.kind === "read" && item.value === link.url);
      if (existing) {
        if (existing.id !== target.id) target.discovered_ids.push(existing.id);
        continue;
      }
      if (state.targets.length >= research_budget.targets) break;
      const entry = { id: "S" + (state.targets.length + 1), kind: "read" as const, item_id: target.item_id,
        value: link.url, label: link.title.trim().slice(0, 180) || link.url };
      state.targets.push(entry);
      target.discovered_ids.push(entry.id);
    }
    target.evidence_ids = [];
    // Search only offers candidate URLs. Only a page read adds citable public evidence.
    // Rank against the question this read serves, or every open question when the read names none.
    const questions = item_of(target.item_id)?.question ?? open_items(state).map(item => item.question).join(" ");
    const focus = [questions, input.brief.intent?.subject ?? input.brief.summary].filter(Boolean).join(" ");
    for (const hit of searching ? [] : rank_passages(hits, focus).slice(0, research_budget.hits_per_read)) {
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
    if (target.status === "empty") input.activity?.("lookup_empty", "Nothing usable from: " + target.value);
    else if (searching) input.activity?.("search_completed", `Found ${target.discovered_ids.length} candidate sources for “${target.value}”`);
    else input.activity?.("page_opened", `Read ${target.canonical_url}`);
    if (target.evidence_ids.length) input.activity?.("sources_saved", `Saved ${target.evidence_ids.length} cited source records.`);
    return target_result(target);
  };

  const plan_coverage = tool({
    description: "Write the checklist of concrete questions the finished brief must answer, before any lookup. Each question names the measure, unit, period or entity it needs. Call again only to add a material question discovered later.",
    inputSchema: z.object({ items: z.array(z.object({
      question: z.string().trim().min(8).max(240),
      needs: z.enum(["number", "fact"]).describe("number when the answer is a quantity, amount, share, rank or date"),
    })).min(1).max(research_budget.checklist_max) }),
    execute: ({ items }) => {
      ensure_owner();
      const room = limits.checklist_max - state.checklist.length;
      if (room <= 0) return { error: "The checklist is full. Work on the open items." };
      const known = new Set(state.checklist.map(item => item.question.toLowerCase()));
      const added = items.slice(0, room).filter(({ question }) => !known.has(question.toLowerCase()));
      for (const { question, needs } of added) {
        state.checklist.push({ id: "C" + (state.checklist.length + 1), question, needs, status: "open", lookups: 0 });
      }
      persist();
      if (added.length) input.activity?.("lookup_requested", `Planned ${state.checklist.length} questions to answer: ` +
        state.checklist.map(item => item.question).join(" · ").slice(0, 600));
      return { checklist: state.checklist.map(coverage_view) };
    },
  });

  const web_search = tool({
    description: "Run up to four public web searches in parallel. Write each query for the answer itself: the entity, the measure, its unit and period, and a likely publisher. Rewrite a query that found nothing useful instead of repeating it. Results are candidate URLs; read them before citing.",
    inputSchema: z.object({ searches: z.array(z.object({
      item_id: z.string().max(8), query: z.string().trim().min(3).max(200),
    })).min(1).max(research_budget.searches_per_call) }),
    execute: async ({ searches }) => {
      ensure_owner();
      if (!state.checklist.length) return { error: "Call plan_coverage before searching." };
      state.pass++;
      const results = await Promise.all(searches.map(async ({ item_id, query }) => {
        const item = item_of(item_id);
        if (!item) return { item_id, query, error: "Unknown checklist item." };
        const existing = state.targets.find(target => target.kind === "search" && query_key(target.value) === query_key(query));
        if (existing?.status) return { item_id, ...target_result(existing), note: "This query already ran. Rewrite it to find something new." };
        const refused = reserve();
        if (refused) return { item_id, query, error: refused };
        item.lookups++;
        const target = existing ?? { id: "S" + (state.targets.length + 1), kind: "search" as const, item_id, value: query, label: query };
        if (!existing) state.targets.push(target);
        return { item_id, ...await look_up(target) };
      }));
      return { results };
    },
  });

  const read_url = tool({
    description: "Read up to four pages in parallel: host-approved URLs or links returned by earlier searches and reads. Returns passages with evidence IDs and further links.",
    inputSchema: z.object({
      source_ids: z.array(z.string().max(20)).min(1).max(research_budget.reads_per_call),
      item_id: z.string().max(8).optional().describe("The checklist item these reads are for"),
    }),
    execute: async ({ source_ids, item_id }) => {
      ensure_owner();
      const item = item_of(item_id);
      const results = await Promise.all([...new Set(source_ids)].map(async source_id => {
        const target = state.targets.find(entry => entry.id === source_id && entry.kind === "read");
        if (!target) return { source_id, error: "Use a source_id from the source list or an earlier result." };
        if (target.status) return target_result(target);
        const refused = reserve();
        if (refused) return { source_id, error: refused };
        if (item) item.lookups++;
        return look_up(target);
      }));
      return { results };
    },
  });

  const record_answers = tool({
    description: "Record checklist answers. Each answer is one complete sentence a presenter could put on a slide, with its number, unit and period, plus a short heading that states the finding. It cites one evidence_id and copies a short verbatim excerpt from that passage that states the answer. Number items need the number in the excerpt.",
    inputSchema: z.object({ answers: z.array(z.object({
      item_id: z.string().max(8), evidence_id: z.string().max(12),
      excerpt: z.string().trim().min(3).max(600), answer: z.string().trim().min(1).max(400),
      heading: z.string().trim().min(3).max(80).optional().describe("A short heading that states the finding, for example \"Imports fell to 243 MT in 2024-25\""),
    })).min(1).max(research_budget.checklist_max) }),
    execute: ({ answers }) => {
      ensure_owner();
      const results = answers.map(({ item_id, evidence_id, excerpt, answer, heading }) => {
        const item = item_of(item_id);
        const record = by_id.get(evidence_id) ?? state.evidence.find(entry => entry.id === evidence_id);
        if (!item) return { item_id, accepted: false, reason: "Unknown checklist item." };
        if (!record) return { item_id, accepted: false, reason: "Unknown evidence ID." };
        if (!quotes(record.passage, excerpt)) return { item_id, accepted: false, reason: "The excerpt is not verbatim in " + evidence_id + "." };
        if (item.needs === "number" && !states_number(excerpt)) return { item_id, accepted: false, reason: "This item needs the number in the excerpt." };
        // The answer becomes slide text, so it may only state figures the source states. No computed differences or rounding.
        if (!numbers_stated_in(answer + " " + (heading ?? ""), record.passage)) {
          return { item_id, accepted: false, reason: "The answer or heading states a number that is not in " + evidence_id + ". Use the source's own figures." };
        }
        Object.assign(item, { status: "covered", answer, heading, evidence_id, excerpt, reason: undefined });
        return { item_id, accepted: true };
      });
      persist();
      const covered = results.filter(result => result.accepted).length;
      if (covered) input.activity?.("verified", `Answered ${state.checklist.filter(item => item.status === "covered").length} of ${state.checklist.length} questions with quoted sources.`);
      return { results, open: open_items(state).map(coverage_view) };
    },
  });

  const mark_unavailable = tool({
    description: "Mark a checklist item unavailable after at least two differently worded lookups for it failed, explaining what was tried.",
    inputSchema: z.object({ item_id: z.string().max(8), reason: z.string().trim().min(8).max(400) }),
    execute: ({ item_id, reason }) => {
      ensure_owner();
      const item = item_of(item_id);
      if (!item) return { error: "Unknown checklist item." };
      if (item.status === "covered") return { error: "This item is already covered." };
      if (item.lookups < limits.tries && state.lookup_attempts < limits.lookups) {
        return { error: "Try at least two differently worded searches or reads for this item first." };
      }
      Object.assign(item, { status: "unavailable", reason });
      persist();
      return { item: coverage_view(item) };
    },
  });

  // Focused research reads the host's own sources and the links they expose; it does not search the open web.
  const registry = (lookups_allowed: boolean): TToolProviders => ({ session: {
    plan_coverage, record_answers, mark_unavailable,
    ...(lookups_allowed && { read_url }),
    ...(lookups_allowed && input.brief.source_policy === "public_search" && research_mode(input) === "broad" && { web_search }),
  } });
  return registry;
};

const selected_context = (input: TCollectResearch, state: TResearchAgentState, reminder?: string) => {
  const mode = research_mode(input);
  const limits = mode_limits[mode];
  const used = new Set(state.checklist.flatMap(item => item.evidence_id ?? []));
  return JSON.stringify({
    as_of: new Date().toISOString().slice(0, 10),
    goal: { summary: input.brief.summary.slice(0, 3600), intent: input.brief.intent, source_policy: input.brief.source_policy },
    confirmed_intake_context: input.brief.messages.slice(-6).map(message => message.slice(0, 660)),
    mode,
    reminder,
    checklist: state.checklist.map(coverage_view),
    budget: { lookups_left: Math.max(0, limits.lookups - state.lookup_attempts), checklist_max: limits.checklist_max,
      searches_per_call: research_budget.searches_per_call, reads_per_call: research_budget.reads_per_call },
    starting_query_ideas: input.brief.public_queries,
    searches_run: state.targets.filter(target => target.kind === "search" && target.status)
      .map(({ value, item_id, status, discovered_ids }) => ({ query: value, item_id, status, candidates: discovered_ids?.length ?? 0 })),
    unread_sources: state.targets.filter(target => target.kind === "read" && !target.status).slice(-60)
      .map(({ id, label, seed, value, item_id }) => ({ source_id: id, label, url: value, host_approved: seed, item_id })),
    read_sources: state.targets.filter(target => target.kind === "read" && target.status)
      .map(({ id, status, canonical_url, value }) => ({ source_id: id, status, url: canonical_url ?? value })),
    evidence: state.evidence.filter(item => !used.has(item.id)).slice(-40)
      .map(({ id, location, passage, origin }) => ({ evidence_id: id, location: location.slice(0, 150), origin, passage: passage.slice(0, 700) })),
  });
};

const finish_gaps = (state: TResearchAgentState, reason: NonNullable<TResearchAgentState["stop_reason"]>) => {
  const gaps = new Set(state.gaps);
  for (const target of state.targets) {
    if (target.seed && (target.status === "failed" || target.status === "empty")) gaps.add("No readable evidence for " + target.label + ".");
  }
  for (const target of pending_seeds(state)) gaps.add("The approved source was not read: " + target.label + ".");
  for (const item of state.checklist) {
    if (item.status === "unavailable") gaps.add(`Not established: ${item.question}${item.reason ? " (" + item.reason + ")" : ""}`);
    if (item.status === "open") gaps.add("Not found within the research budget: " + item.question);
  }
  if (reason === "budget") gaps.add("Research reached its discovery limit. The brief uses the evidence available so far.");
  return [...gaps];
};

export const collect_research = async (input: TCollectResearch): Promise<TResearchAgentState> => {
  const prior = input.previous;
  const state = prior?.version === 4 && prior.brief_id === input.brief.brief_id ? structuredClone(prior) : initial_state(input);
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
    state.gaps = finish_gaps(state, reason);
    state.stop_reason = reason;
    persist();
  };
  const mode = research_mode(input);
  const limits = mode_limits[mode];
  // Files-only work, or host files with no links to read, uses the supplied material as is with no discovery model call.
  if (input.brief.source_policy === "files_only" || (mode === "focused" && !input.brief.urls.length)) {
    finish("finished");
    return state;
  }
  const remaining_ms = state.started_at + research_budget.duration_ms - Date.now();
  const deadline = AbortSignal.timeout(Math.max(1, remaining_ms));
  const signal = AbortSignal.any([input.signal, deadline]);
  const tools = research_tools(input, state, signal, persist);
  const has_budget = () => !deadline.aborted && within_usage_budget(state);
  let latest_text = "";
  let reminder: string | undefined;
  let reminders = 0;
  try {
    if (remaining_ms > 0) await SessionRunner.run_steps(input.model_step, {
      completed_steps: state.steps, max_steps: limits.steps,
      select_step: step => {
        if (!has_budget()) return;
        state.steps = step;
        latest_text = "";
        persist();
        const lookups_allowed = state.lookup_attempts < limits.lookups && input.brief.source_policy === "public_search";
        return {
          instructions: research_agent, ephemeral: true, parallel_tool_calls: true,
          messages: [...state.messages, { role: "user", content: selected_context(input, state, reminder) }],
          tool_providers: tools(lookups_allowed), signal,
          on_text: text => { latest_text = (latest_text + text).slice(0, 4000); },
          on_attempt: attempt => { state.model_attempts.push(attempt); persist(); },
        };
      },
      checkpoint: (_step, result) => {
        state.messages = JSON.stringify(result.messages).length <= research_budget.retained_history_chars ? result.messages : [];
        if (result.continue_with_tools) {
          reminder = undefined;
          persist();
          return false;
        }
        // The model wants to stop. Accept only when the checklist is resolved and approved sources were tried.
        const open = open_items(state);
        const unread = input.brief.source_policy === "public_search" ? pending_seeds(state) : [];
        const lookups_left = state.lookup_attempts < limits.lookups && input.brief.source_policy === "public_search";
        const outstanding = !state.checklist.length
          ? "Call plan_coverage first: list the concrete questions this brief must answer."
          : unread.length && lookups_left
            ? "Read the host-approved sources before finishing: " + unread.map(source => source.id).join(", ") + "."
            : open.length && lookups_left
              ? "These checklist items are still open: " + open.map(item => `${item.id} (${item.question}; ${item.lookups} lookups)`).join("; ") +
                (mode === "broad"
                  ? ". First record any answers the evidence already states. Then rewrite queries for the rest (name the measure, unit, period and a likely publisher) and search in parallel, read the best candidates, or mark an item unavailable after two different tries."
                  : ". Record any answers the host's pages already state. Read other linked pages on the host's site that could answer the rest, or mark an item unavailable if the host's sources do not cover it.")
              : open.length
                ? "The lookup budget is used up. Record every answer the evidence below states for the open items " +
                  open.map(item => item.id).join(", ") + ", then mark the rest unavailable with what you tried."
                : undefined;
        if (outstanding && reminders < research_budget.reminders && has_budget()) {
          reminders++;
          reminder = outstanding;
          persist();
          return false;
        }
        state.research_notes = latest_text.trim() || undefined;
        finish(open.length || !state.checklist.length ? "budget" : "finished");
        return true;
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
