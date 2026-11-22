import { z } from "zod";
import type { TMissionTurnBasis, TVoiceAction } from "./studio-turn";
import { action_inputs, nullable_mission_patch, parse_mission_patch, pitch_intent } from "../types/studio-turn";
import type { TStudioActivity, TStudioTurn } from "../types/studio-turn";
import { MAX_PRESENTATION_SLIDES } from "../../../shared/presentation";
import { live_tool } from "./prompts";
import { isLiveHostTail as is_live_host_tail, LIVE_BACKCHANNEL_MS, LIVE_EXCHANGE_IDLE_MS } from "../../../shared/voice-transcript";

// Turns the Live session's event stream into saved exchanges and controller-checked actions. The Live model hears and
// speaks on its own; this module only records what was said and decides what the delegated tool calls may change.
export type TLiveExchange = { turn_id: string; host: string; agent: string; voice_items: string[]; voice_reply?: string; activity?: TStudioActivity };
type TLiveHooks = {
  send: (event: object) => void;
  close: () => void;
  record: (exchange: TLiveExchange) => void;
  act: (message: string, action: TVoiceAction, mission?: TMissionTurnBasis) => TStudioTurn | Promise<TStudioTurn>;
  heard: (proposal_id: string, turn_id: string) => void;
  mission_version?: () => TMissionTurnBasis | undefined;
  caption_scope?: string;
  idle_ms?: number;
};
type TPlanReading = { proposal_id: string; turn_id: string; spoken_until?: number; required?: string[][] };
type TPendingStart = {
  call_id: string; reading: TPlanReading; delegated_at: number; timer: ReturnType<typeof setTimeout>; apply: () => void;
};
type TPendingHostCommand = {
  call_id: string; delegated_at: number; mission?: TMissionTurnBasis; timer: ReturnType<typeof setTimeout>; apply: () => void;
  // What the host had said when the tool call arrived. The agent often speaks a lead-in before calling the tool,
  // so no newer host transcript may follow; these words are then the command's basis.
  spoken?: { text: string; until: number; mission?: TMissionTurnBasis };
};
const HOST_COMMAND_TAIL_MS = 120;
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
  prepare_slides: action_inputs.prepare_slides.extend({ focus: action_inputs.prepare_slides.shape.focus.nullable() }),
  revise_slide: action_inputs.revise_slide.extend({ slide_number: action_inputs.revise_slide.shape.slide_number.nullable() }),
  mission_command: nullable_mission_patch,
};
const text = (description: string) => ({ type: "string", description });
const intent_fields = { subject: text(live_tool.subject), audience: text(live_tool.audience), outcome: text(live_tool.outcome), deliverable: text(live_tool.deliverable) };
const mission_parameters = z.toJSONSchema(nullable_mission_patch);
const spoken_tokens = (text: string) => {
  const normalized = text.normalize("NFKC").toLowerCase().replace(/[\u0966-\u096f\u0c66-\u0c6f]/gu, digit => {
    const zero = digit < "\u0c66" ? "\u0966" : "\u0c66";
    return String(digit.charCodeAt(0) - zero.charCodeAt(0));
  });
  return (normalized.match(/[\p{L}\p{M}]+|\p{N}+(?:\.\p{N}+)?|\$/gu) ?? []).join(" ");
};
const covers_readback = (text: string, required: string[][]) => {
  const actual = ` ${spoken_tokens(text)} `;
  return required.every(choices => choices.some(phrase => {
    const expected = spoken_tokens(phrase);
    return !!expected && actual.includes(` ${expected} `);
  }));
};

export const live_tools = [
  { type: "function", name: "propose_research", strict: true, description: live_tool.propose_research,
    parameters: { type: "object", additionalProperties: false, required: [...Object.keys(intent_fields), "summary", "queries", "urls", "factual_notes"], properties: {
      ...intent_fields, summary: text(live_tool.summary),
      queries: { type: "array", items: { type: "string" }, description: live_tool.queries },
      factual_notes: { type: "array", items: { type: "string" }, description: live_tool.factual_notes },
      urls: { type: "array", items: { type: "string" }, description: live_tool.urls } } } },
  { type: "function", name: "start_research", strict: true, description: live_tool.start_research,
    parameters: { type: "object", additionalProperties: false, required: [], properties: {} } },
  { type: "function", name: "prepare_slides", strict: true, description: live_tool.prepare_slides,
    parameters: { type: "object", additionalProperties: false, required: ["slide_count", "focus"], properties: {
      slide_count: { type: "integer", minimum: 1, maximum: MAX_PRESENTATION_SLIDES }, focus: { type: ["string", "null"] },
    } } },
  { type: "function", name: "revise_slide", strict: true, description: live_tool.revise_slide,
    parameters: { type: "object", additionalProperties: false, required: ["slide_number", "instruction"], properties: {
      slide_number: { type: ["integer", "null"], minimum: 1, maximum: MAX_PRESENTATION_SLIDES }, instruction: { type: "string" },
    } } },
  { type: "function", name: "mission_command", strict: true, description: live_tool.mission_command,
    parameters: { type: "object", additionalProperties: false, required: mission_parameters.required, properties: mission_parameters.properties } },
];

export const create_live_interviewer = (hooks: TLiveHooks) => {
  let host = "";
  let host_from: number | undefined;
  let host_until: number | undefined;
  let host_mission: TMissionTurnBasis | undefined;
  let agent = "";
  let agent_from: number | undefined;
  let agent_until = 0;
  let activity: TStudioActivity | undefined;
  let reading: TPlanReading | undefined;
  let pending_start: TPendingStart | undefined;
  let pending_command: TPendingHostCommand | undefined;
  let command_tail: ReturnType<typeof setTimeout> | undefined;
  let closing = false;
  let closed = false;
  let idle: ReturnType<typeof setTimeout> | undefined;
  const received = new Set<string>();
  const delegations = new Map<string, { at: number; mission?: TMissionTurnBasis }>();
  const handled_calls = new Set<string>();
  const caption_id = (speaker: "live" | "agent", start: number) =>
    hooks.caption_scope ? `${speaker}:${hooks.caption_scope}:${start}` : `${speaker}:${start}`;

  const finish_exchange = () => {
    clearTimeout(idle);
    if (host.trim() || agent.trim() || activity) {
      hooks.record({ turn_id: crypto.randomUUID(), host: host.trim(), agent: agent.trim(),
        voice_items: host_from === undefined ? [] : [caption_id("live", host_from)],
        ...(agent.trim() && agent_from !== undefined && { voice_reply: caption_id("agent", agent_from) }),
        ...(activity && { activity }) });
    }
    host = ""; host_from = undefined; host_until = undefined; host_mission = undefined;
    agent = ""; agent_from = undefined; agent_until = 0;
    activity = undefined;
  };
  const close = () => {
    if (closed) return;
    closed = true;
    clearTimeout(pending_start?.timer);
    clearTimeout(pending_command?.timer);
    clearTimeout(command_tail);
    pending_start = undefined;
    pending_command = undefined;
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
    else {
      const button = pending.reading.required ? "the Approve plan button in Mission" : "the Start research button";
      reply(pending.call_id, `Research has not started. The spoken approval could not be confirmed. Keep the saved plan and offer ${button}.`);
    }
  };
  const resolve_pending_command = (matched: boolean) => {
    const pending = pending_command;
    if (!pending) return;
    pending_command = undefined;
    clearTimeout(pending.timer);
    clearTimeout(command_tail);
    trace({ tool: "command", outcome: matched ? "command_confirmed" : "command_unmatched" });
    if (matched) pending.apply();
    else reply(pending.call_id, "The spoken request could not be matched to this change. Keep the saved work and offer the private project conversation.");
  };
  const confirm_command_after_tail = (pending: TPendingHostCommand, host_end: number) => {
    const { delegated_at, mission } = pending;
    const matched = host_end <= delegated_at && (!mission || mission.mission_id === host_mission?.mission_id && mission.revision === host_mission.revision);
    // Name the failed condition so a dropped spoken change can be diagnosed from the logs.
    if (!matched) trace({ tool: "command", outcome: host_end > delegated_at ? "command_after_delegation" : "command_mission_changed" });
    clearTimeout(command_tail);
    if (!matched) resolve_pending_command(false);
    else command_tail = setTimeout(() => resolve_pending_command(true), Math.min(HOST_COMMAND_TAIL_MS, (hooks.idle_ms ?? LIVE_EXCHANGE_IDLE_MS) / 2));
  };
  const result_for = (turn: TStudioTurn, kind: TVoiceAction["kind"]) => {
    if (kind === "prepare_slides" || kind === "revise_slide" || kind === "mission_command") {
      activity = turn.activity;
      return `Tell the host in their language: ${turn.text}`;
    }
    if (turn.phase === "researching" && turn.activity?.tool === "queue_research") {
      closing = true;
      return "Research has started. Tell the host in one short sentence, in their language, that you are starting and will let them know when it is ready. Then stop.";
    }
    if (turn.phase === "proposed" && turn.proposal) {
      reading = { proposal_id: turn.proposal.proposal_id, turn_id: turn.turn_id, required: turn.mission_readback?.required };
      const links = turn.proposal.urls.length ? ` Links: ${turn.proposal.urls.join(", ")}.` : "";
      const lead = kind === "start_research" ? "Not started yet: the host must hear the whole plan and then approve it. " : "Plan saved. ";
      const mission = turn.mission_readback ? ` Read the outcome details aloud without omitting the size, sources, limits or exact host statements: "${turn.mission_readback.text}". If the host wants to approve without the full spoken readback, direct them to the private Mission approval card.` : "";
      return `${lead}Read this plan to the host in their language: "${turn.proposal.summary}".${links}${mission} Then ask whether to start the research. Do not say it has started.`;
    }
    return kind === "start_research" ? "Not started: there is no saved plan yet. Keep asking what the pitch is about, who it is for and what outcome they want."
      : "Not saved: the pitch topic is still unclear. Ask the host what the pitch is about.";
  };
  const delegate = (call_id: string, name: string, raw: string, dispatch?: { at: number; mission?: TMissionTurnBasis }) => {
    const delegated_at = dispatch?.at;
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
    let action: TVoiceAction = { kind: "start_research" };
    if (name === "propose_research") action = { kind: "propose_research", goal: String(data.subject), summary: String(data.summary),
      queries: data.queries as string[], urls: data.urls as string[], factual_notes: data.factual_notes as string[] | undefined,
      intent: { subject: String(data.subject), audience: String(data.audience),
        outcome: String(data.outcome), deliverable: String(data.deliverable) } };
    if (name === "prepare_slides") action = { kind: "prepare_slides", slide_count: Number(data.slide_count),
      ...(typeof data.focus === "string" && { focus: data.focus }) };
    if (name === "revise_slide") action = { kind: "revise_slide", instruction: String(data.instruction),
      ...(typeof data.slide_number === "number" && { slide_number: data.slide_number }) };
    if (name === "mission_command") {
      const patch = parse_mission_patch(nullable_mission_patch.parse(data));
      if (!patch.success) { reply(call_id, "Ask the host what should change in the plan."); return; }
      action = { kind: "mission_command", patch: patch.data };
    }
    const done = (turn: TStudioTurn) => {
      trace({ tool: name, outcome: "applied", phase: turn.phase, proposal: !!turn.proposal });
      reply(call_id, result_for(turn, action.kind));
    };
    const failed = (cause: unknown) => {
      trace({ tool: name, outcome: "rejected" });
      reply(call_id, "Not done: " + (cause instanceof Error ? cause.message : "the change could not be saved") + ".");
    };
    const apply = () => {
      try {
        const said = host.trim() ? { text: host, mission: host_mission } : { text: spoken?.text ?? "", mission: spoken?.mission };
        const turn = hooks.act(said.text, action, action.kind === "mission_command" ? said.mission : undefined);
        if (turn instanceof Promise) void turn.then(done, failed);
        else done(turn);
      } catch (cause) {
        failed(cause);
      }
    };
    const spoken = host.trim() && host_until !== undefined ? { text: host, until: host_until, mission: host_mission } : undefined;
    if (action.kind === "propose_research") resolve_pending_start(false);
    if (["prepare_slides", "revise_slide", "mission_command"].includes(action.kind)) {
      const transcript_pending = !host.trim() || (dispatch && (host_until ?? 0) <= agent_until);
      if (dispatch) {
        const mission = action.kind === "mission_command" ? dispatch.mission : undefined;
        if (action.kind === "mission_command" && !mission) { reply(call_id, "Open the current Mission to request a change."); return; }
        if (pending_command) { reply(call_id, "The first spoken change is already being checked."); return; }
        const timer = setTimeout(() => {
          // No newer transcript arrived: confirm against the words already heard, if they ended before the call and match the revision.
          const basis = pending_command?.spoken;
          const heard = !!basis && basis.until <= dispatch.at &&
            (!mission || mission.mission_id === basis.mission?.mission_id && mission.revision === basis.mission?.revision);
          trace({ tool: name, outcome: heard ? "command_confirmed_from_earlier_words" : "command_without_host_words" });
          resolve_pending_command(heard);
        }, hooks.idle_ms ?? LIVE_EXCHANGE_IDLE_MS);
        pending_command = { call_id, delegated_at: dispatch.at, mission, timer, apply, spoken };
        if (!transcript_pending && host_until !== undefined) confirm_command_after_tail(pending_command, host_until);
        else trace({ tool: name, outcome: "awaiting_command_transcript" });
        return;
      }
      if (transcript_pending) { reply(call_id, "Open the project conversation to request a deck change."); return; }
    }
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
      delegations.set(event.delegation.id, { at: event.offset_ms, mission: hooks.mission_version?.() });
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
        const complete = !reading.required || covers_readback(agent, reading.required);
        let heard = complete && event.start_ms !== undefined && start >= reading.spoken_until;
        if (heard) {
          try { hooks.heard(reading.proposal_id, reading.turn_id); }
          catch {
            heard = false;
            trace({ tool: "start_research", outcome: "saved_plan_changed" });
          }
        }
        matches_approval = heard && !!pending && event.end_ms !== undefined && event.end_ms <= pending.delegated_at;
        reading = undefined;
      }
      if (!late_tail && agent.trim()) {
        const backchannel = agent_until - (agent_from ?? agent_until) < LIVE_BACKCHANNEL_MS && start - agent_until < LIVE_BACKCHANNEL_MS;
        if (backchannel) { agent = ""; agent_from = undefined; agent_until = 0; clearTimeout(idle); }
        else finish_exchange();
      }
      if (host_from === undefined) { host_from = start; host_mission = hooks.mission_version?.(); }
      host_until = Math.max(host_until ?? start, event.end_ms ?? start);
      host += event.delta;
      if (pending_command && event.end_ms !== undefined) confirm_command_after_tail(pending_command, event.end_ms);
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
        const dispatch = event.delegation_id ? delegations.get(event.delegation_id) : undefined;
        if (event.delegation_id) delegations.delete(event.delegation_id);
        delegate(item.call_id, item.name, item.arguments ?? "", dispatch);
      }
    } else if (event.type === "session.closed") close();
  };
  // Something outside the voice call is about to change the conversation (a typed turn, a button): save what was said first.
  const flush = () => { resolve_pending_start(false); resolve_pending_command(false); finish_exchange(); };
  return { receive, close, flush };
};
