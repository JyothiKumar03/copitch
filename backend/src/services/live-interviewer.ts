import { z } from "zod";
import type { TVoiceAction } from "./studio-turn";
import { action_inputs, pitch_intent } from "../types/studio-turn";
import type { TStudioTurn } from "../types/studio-turn";
import { live_tool } from "./prompts";
import { isLiveHostTail as is_live_host_tail, LIVE_BACKCHANNEL_MS, LIVE_EXCHANGE_IDLE_MS } from "../../../shared/voice-transcript";

// Turns the Live session's event stream into saved exchanges and controller-checked actions. The Live model hears and
// speaks on its own; this module only records what was said and decides what the delegated tool calls may change.
export type TLiveExchange = { turn_id: string; host: string; agent: string; voice_items: string[]; voice_reply?: string };
type TLiveHooks = {
  send: (event: object) => void;
  close: () => void;
  record: (exchange: TLiveExchange) => void;
  act: (message: string, action: TVoiceAction) => TStudioTurn;
  heard: (proposal_id: string, turn_id: string) => void;
  caption_scope?: string;
  idle_ms?: number;
};
type TPlanReading = { proposal_id: string; turn_id: string; spoken_until?: number };
type TPendingStart = {
  call_id: string; reading: TPlanReading; delegated_at: number; timer: ReturnType<typeof setTimeout>; apply: () => void;
};
// Delegation outcomes are otherwise invisible: the voice model keeps talking whatever happens. Names and outcomes only.
const trace = (fields: Record<string, unknown>) => {
  if (process.env.TRACE_LOGS === "1") console.log(JSON.stringify({ operation: "live.delegation", ...fields }));
};
const ident = z.string().min(1).max(200);
const event_schema = z.object({
  type: z.string(), event_id: ident.optional(), delta: z.string().max(8000).optional(),
  start_ms: z.number().int().nonnegative().optional(), end_ms: z.number().int().nonnegative().optional(),
  offset_ms: z.number().int().nonnegative().optional(), delegation_id: ident.nullish(),
  delegation: z.object({ id: ident, target: z.string() }).optional(),
  event: z.object({ type: z.string(), item: z.object({ type: z.string(), name: z.string().max(80).optional(), call_id: ident.optional(),
    arguments: z.string().max(10000).optional() }).optional() }).optional(),
});
const tool_inputs = {
  propose_research: pitch_intent.extend({ summary: z.string().trim().min(1).max(600),
    queries: z.array(z.string().trim().min(1).max(200)).max(3), urls: z.array(z.string().max(2048)).max(8),
    factual_notes: action_inputs.remember.shape.notes.optional() }).strict(),
  start_research: z.strictObject({}),
};
const text = (description: string) => ({ type: "string", description });
const intent_fields = { subject: text(live_tool.subject), audience: text(live_tool.audience), outcome: text(live_tool.outcome), deliverable: text(live_tool.deliverable) };

export const live_tools = [
  { type: "function", name: "propose_research", strict: true, description: live_tool.propose_research,
    parameters: { type: "object", additionalProperties: false, required: [...Object.keys(intent_fields), "summary", "queries", "urls", "factual_notes"], properties: {
      ...intent_fields, summary: text(live_tool.summary),
      queries: { type: "array", items: { type: "string" }, description: live_tool.queries },
      factual_notes: { type: "array", items: { type: "string" }, description: live_tool.factual_notes },
      urls: { type: "array", items: { type: "string" }, description: live_tool.urls } } } },
  { type: "function", name: "start_research", strict: true, description: live_tool.start_research,
    parameters: { type: "object", additionalProperties: false, required: [], properties: {} } },
];

export const create_live_interviewer = (hooks: TLiveHooks) => {
  let host = "";
  let host_from: number | undefined;
  let host_until: number | undefined;
  let agent = "";
  let agent_from: number | undefined;
  let agent_until = 0;
  let reading: TPlanReading | undefined;
  let pending_start: TPendingStart | undefined;
  let closing = false;
  let closed = false;
  let idle: ReturnType<typeof setTimeout> | undefined;
  const received = new Set<string>();
  const delegation_times = new Map<string, number>();
  const handled_calls = new Set<string>();
  const caption_id = (speaker: "live" | "agent", start: number) =>
    hooks.caption_scope ? `${speaker}:${hooks.caption_scope}:${start}` : `${speaker}:${start}`;

  const finish_exchange = () => {
    clearTimeout(idle);
    if (host.trim() || agent.trim()) {
      hooks.record({ turn_id: crypto.randomUUID(), host: host.trim(), agent: agent.trim(),
        voice_items: host_from === undefined ? [] : [caption_id("live", host_from)],
        ...(agent.trim() && agent_from !== undefined && { voice_reply: caption_id("agent", agent_from) }) });
    }
    host = ""; host_from = undefined; host_until = undefined;
    agent = ""; agent_from = undefined; agent_until = 0;
  };
  const close = () => {
    if (closed) return;
    closed = true;
    clearTimeout(pending_start?.timer);
    pending_start = undefined;
    try { finish_exchange(); } finally { hooks.close(); }
  };
  const after_reply_quiet = () => {
    clearTimeout(idle);
    idle = setTimeout(() => (closing ? close() : finish_exchange()), hooks.idle_ms ?? LIVE_EXCHANGE_IDLE_MS);
  };
  const reply = (call_id: string, output: string) => {
    hooks.send({ type: "response.item.create", item: { type: "function_call_output", call_id, output } });
    hooks.send({ type: "response.create" });
  };
  const resolve_pending_start = (matched: boolean) => {
    const pending = pending_start;
    if (!pending) return;
    pending_start = undefined;
    clearTimeout(pending.timer);
    if (matched) pending.apply();
    else reply(pending.call_id, "Research has not started. The spoken approval could not be confirmed. Keep the saved plan and offer the Start research button.");
  };
  const result_for = (turn: TStudioTurn, kind: TVoiceAction["kind"]) => {
    if (turn.phase === "researching" && turn.activity?.tool === "queue_research") {
      closing = true;
      return "Research has started. Tell the host in one short sentence, in their language, that you are starting and will let them know when it is ready. Then stop.";
    }
    if (turn.phase === "proposed" && turn.proposal) {
      reading = { proposal_id: turn.proposal.proposal_id, turn_id: turn.turn_id };
      const links = turn.proposal.urls.length ? ` Links: ${turn.proposal.urls.join(", ")}.` : "";
      const lead = kind === "start_research" ? "Not started yet: the host must hear the whole plan and then approve it. " : "Plan saved. ";
      return `${lead}Read this plan to the host in their language: "${turn.proposal.summary}".${links} Then ask whether to start the research. Do not say it has started.`;
    }
    return kind === "start_research" ? "Not started: there is no saved plan yet. Keep asking what the pitch is about, who it is for and what outcome they want."
      : "Not saved: the pitch topic is still unclear. Ask the host what the pitch is about.";
  };
  const delegate = (call_id: string, name: string, raw: string, delegated_at?: number) => {
    if (handled_calls.has(call_id)) return;
    handled_calls.add(call_id);
    if (!Object.hasOwn(tool_inputs, name)) { trace({ outcome: "unknown_tool" }); reply(call_id, "Not done: that action is not available."); return; }
    trace({ tool: name, outcome: "received" });
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { parsed = undefined; }
    const args = tool_inputs[name as keyof typeof tool_inputs].safeParse(parsed);
    if (!args.success) {
      trace({ tool: name, outcome: "invalid_arguments", issues: args.error.issues.map(issue => issue.path.join(".") + ":" + issue.code).slice(0, 8) });
      reply(call_id, "Not done: the request was incomplete. Ask the host for what is missing.");
      return;
    }
    const data = args.data as Record<string, unknown>;
    const action: TVoiceAction = name === "propose_research" ? { kind: "propose_research", goal: String(data.subject), summary: String(data.summary),
      queries: data.queries as string[], urls: data.urls as string[], factual_notes: data.factual_notes as string[] | undefined,
      intent: { subject: String(data.subject), audience: String(data.audience),
        outcome: String(data.outcome), deliverable: String(data.deliverable) } } : { kind: "start_research" };
    const apply = () => {
      try {
        const turn = hooks.act(host, action);
        trace({ tool: name, outcome: "applied", phase: turn.phase, proposal: !!turn.proposal });
        reply(call_id, result_for(turn, action.kind));
      } catch (cause) {
        trace({ tool: name, outcome: "rejected" });
        reply(call_id, "Not done: " + (cause instanceof Error ? cause.message : "the change could not be saved") + ".");
      }
    };
    if (action.kind === "propose_research") resolve_pending_start(false);
    // A Responses tool can finish before Live delivers the host fragment that prompted it.
    // Wait only when the provider identifies a delegation after this exact plan's readback.
    if (action.kind === "start_research" && reading?.spoken_until !== undefined &&
        delegated_at !== undefined && delegated_at > reading.spoken_until) {
      if (pending_start) {
        reply(call_id, "Research has not started. The first spoken approval is still being verified.");
        return;
      }
      trace({ tool: name, outcome: "awaiting_approval_transcript" });
      const timer = setTimeout(() => resolve_pending_start(false), hooks.idle_ms ?? LIVE_EXCHANGE_IDLE_MS);
      pending_start = { call_id, reading, delegated_at, timer, apply };
      return;
    }
    apply();
  };

  const receive = async (raw: unknown) => {
    if (closed) return;
    const parsed = event_schema.safeParse(raw);
    if (!parsed.success) return;
    const event = parsed.data;
    if (event.event_id) {
      if (received.has(event.event_id)) return;
      received.add(event.event_id);
    }
    if (event.start_ms !== undefined && event.end_ms !== undefined && event.end_ms < event.start_ms) return;
    if (event.type === "session.delegation.created" && event.delegation?.target === "responses" && event.offset_ms !== undefined) {
      delegation_times.set(event.delegation.id, event.offset_ms);
    } else if (event.type === "session.input_transcript.delta" && event.delta) {
      const start = event.start_ms ?? 0;
      // The last input token and the start of a reply can overlap on the provider clock.
      const late_tail = is_live_host_tail(event.start_ms, host_until, agent_until);
      // The host spoke after the agent finished reading the plan, so the whole plan was audible before any reply.
      let resolves_approval = false;
      let matches_approval = false;
      // The caption gap only affects grouping. Plan approval retains its strict timestamp boundary.
      if (reading?.spoken_until !== undefined && !is_live_host_tail(event.start_ms, host_until, agent_until, 0)) {
        const pending = pending_start?.reading === reading ? pending_start : undefined;
        resolves_approval = !!pending;
        const heard = event.start_ms !== undefined && start >= reading.spoken_until;
        if (heard) hooks.heard(reading.proposal_id, reading.turn_id);
        matches_approval = heard && !!pending && event.end_ms !== undefined && event.end_ms <= pending.delegated_at;
        reading = undefined;
      }
      if (!late_tail && agent.trim()) {
        const backchannel = agent_until - (agent_from ?? agent_until) < LIVE_BACKCHANNEL_MS && start - agent_until < LIVE_BACKCHANNEL_MS;
        if (backchannel) { agent = ""; agent_from = undefined; agent_until = 0; clearTimeout(idle); }
        else finish_exchange();
      }
      host_from ??= start;
      host_until = Math.max(host_until ?? start, event.end_ms ?? start);
      host += event.delta;
      if (late_tail && agent.trim()) after_reply_quiet();
      if (resolves_approval) resolve_pending_start(matches_approval);
    } else if (event.type === "session.output_transcript.delta" && event.delta) {
      agent += event.delta;
      agent_from ??= event.start_ms ?? 0;
      agent_until = Math.max(agent_until, event.end_ms ?? event.start_ms ?? 0);
      if (reading) reading.spoken_until = Math.max(reading.spoken_until ?? 0, event.end_ms ?? event.start_ms ?? 0);
      after_reply_quiet();
    } else if (event.type === "response.event" && event.event?.type === "response.output_item.done") {
      const item = event.event.item;
      if (item?.type === "function_call" && item.name && item.call_id) {
        const when = event.delegation_id ? delegation_times.get(event.delegation_id) : undefined;
        if (event.delegation_id) delegation_times.delete(event.delegation_id);
        delegate(item.call_id, item.name, item.arguments ?? "", when);
      }
    } else if (event.type === "session.closed") close();
  };
  // Something outside the voice call is about to change the conversation (a typed turn, a button): save what was said first.
  const flush = () => { resolve_pending_start(false); finish_exchange(); };
  return { receive, close, flush };
};
