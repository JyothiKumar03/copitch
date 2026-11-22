import { expect, test } from "bun:test";
import { create_live_interviewer } from "../src/services/live-interviewer";
import type { TLiveExchange } from "../src/services/live-interviewer";
import { SessionStore } from "../src/repositories/session";
import { apply_voice_action, record_voice_exchange, studio_context } from "../src/services/studio-turn";
import type { TVoiceAction } from "../src/services/studio-turn";
import type { TMissionTurnBasis } from "../src/services/studio-turn";
import type { TStudioTurn } from "../src/types/studio-turn";

type TSent = { type: string; item?: { type: string; call_id: string; output: string } };
const pause = (ms = 15) => new Promise(resolve => setTimeout(resolve, ms));
const proposal = { proposal_id: "plan-1", summary: "Review jk-ai.in for a bank pitch", urls: ["https://jk-ai.in/"], queries: [], source_policy: "public_search" as const };

test("a spoken count delegates to the controller, records the receipt, and keeps the call open", async () => {
  const exchanges: TLiveExchange[] = [];
  const sent: TSent[] = [];
  const activity = { tool: "prepare_slides", status: "queued", result: "Preparing 4 slides.",
    deck_preparation: { research_id: "research", slide_count: 4, job_id: "job" } } as const;
  let calls = 0;
  let closed = false;
  const live = create_live_interviewer({ send: event => sent.push(event as TSent), close: () => { closed = true; }, heard: () => {},
    record: exchange => exchanges.push(exchange), act: (message, action) => {
      expect(message).toBe("Make it four slides.");
      expect(action).toEqual({ kind: "prepare_slides", slide_count: 4 });
      calls++;
      return { phase: "done", proposal: null, turn_id: "turn", language: "en", created_at: 0, user_text: message,
        text: "Preparing 4 slides.", activity };
    } });
  await live.receive({ type: "session.input_transcript.delta", start_ms: 100, end_ms: 1000, delta: "Make it four slides." });
  const delegation = { type: "response.event", event: { type: "response.output_item.done", item: {
    type: "function_call", call_id: "deck-count", name: "prepare_slides", arguments: JSON.stringify({ slide_count: 4, focus: null }) } } };
  await live.receive(delegation);
  await live.receive(delegation);
  await live.receive({ type: "session.output_transcript.delta", start_ms: 1100, end_ms: 1600, delta: "Preparing four slides." });
  live.flush();
  expect(calls).toBe(1);
  expect(sent[0]?.item?.output).toContain("Preparing 4 slides.");
  expect(exchanges[0]?.activity).toEqual(activity);
  expect(closed).toBe(false);
  live.close();
});

const setup = (result: (action: TVoiceAction) => Partial<TStudioTurn> = () => ({})) => {
  const sent: TSent[] = [];
  const recorded: { host: string; agent: string; voice_items: string[] }[] = [];
  const acted: { message: string; action: TVoiceAction }[] = [];
  const heard: string[] = [];
  let closed = 0;
  const live = create_live_interviewer({
    send: event => sent.push(event as TSent), close: () => { closed++; }, idle_ms: 10,
    record: exchange => { recorded.push({ host: exchange.host, agent: exchange.agent, voice_items: exchange.voice_items }); },
    act: (message, action) => { acted.push({ message, action }); return { turn_id: "turn-1", text: "", phase: "interview", ...result(action) } as TStudioTurn; },
    heard: (proposal_id, turn_id) => heard.push(proposal_id + "/" + turn_id),
  });
  const host = (delta: string, start_ms: number) => live.receive({ type: "session.input_transcript.delta", delta, start_ms, end_ms: start_ms + 400 });
  const agent = (delta: string, start_ms: number) => live.receive({ type: "session.output_transcript.delta", delta, start_ms, end_ms: start_ms + 400 });
  const tool = (name: string, args: object, call_id = "call-1") => live.receive({ type: "response.event", delegation_id: "d1",
    event: { type: "response.output_item.done", item: { type: "function_call", name, call_id, arguments: JSON.stringify(args) } } });
  return { live, sent, recorded, acted, heard, closed: () => closed, host, agent, tool };
};

test("one exchange is the host's words then the agent's reply, saved verbatim when the host speaks again", async () => {
  const f = setup();
  await f.host("నేను ఒక URL ఇస్తా, ", 1000);
  await f.host("నా పైన ఒక PPT చెయ్యి.", 1500);
  await f.agent("సరే, ఆ URL ఏమిటి?", 3000);
  await f.host("jk-ai.in", 5000);
  expect(f.recorded).toEqual([{ host: "నేను ఒక URL ఇస్తా, నా పైన ఒక PPT చెయ్యి.", agent: "సరే, ఆ URL ఏమిటి?", voice_items: ["live:1000"] }]);
  f.live.close();
});

test("an exchange is also saved once the agent has gone quiet", async () => {
  const f = setup();
  await f.host("Hello", 100);
  await f.agent("Hi! What do you want to pitch?", 900);
  await pause();
  expect(f.recorded).toEqual([{ host: "Hello", agent: "Hi! What do you want to pitch?", voice_items: ["live:100"] }]);
  f.live.close();
});

test("a late host token on the same provider clock keeps the start of the reply", async () => {
  const f = setup();
  await f.host("I want to present to my new colleagues", 3600);
  await f.agent("Nice", 3600);
  await f.host(".", 3800);
  await f.agent(". What's the main topic?", 3800);
  f.live.flush();
  expect(f.recorded).toEqual([{ host: "I want to present to my new colleagues.",
    agent: "Nice. What's the main topic?", voice_items: ["live:3600"] }]);
  f.live.close();
});

test("real English caption boundaries preserve a reply prefix while the final host token arrives", async () => {
  const cases = [
    {
      host: "Would you ask me the most important planning", host_start: 2400, host_end: 7000,
      prefix: " Who’s", agent_start: 7200, boundary: 7400, host_tail: " question?", next: " your audience for this talk?",
    },
    {
      host: "My audience is the volunteers who run the reading", host_start: 28200, host_end: 32800,
      prefix: " Got it", agent_start: 32800, boundary: 33000, host_tail: " club", next: ". What’s the main thing?",
    },
  ];
  for (const sample of cases) {
    const recorded: TLiveExchange[] = [];
    const live = create_live_interviewer({ send: () => {}, close: () => {}, record: value => recorded.push(value), heard: () => {},
      act: () => { throw new Error("Transcript deltas cannot act"); } });
    const input = (delta: string, start_ms: number, end_ms: number) => live.receive({ type: "session.input_transcript.delta", delta, start_ms, end_ms });
    const output = (delta: string, start_ms: number, end_ms: number) => live.receive({ type: "session.output_transcript.delta", delta, start_ms, end_ms });
    try {
      await input(sample.host, sample.host_start, sample.host_end);
      await output(sample.prefix, sample.agent_start, sample.boundary);
      await input(sample.host_tail, sample.boundary, sample.boundary + 200);
      await output(sample.next, sample.boundary, sample.boundary + 200);
    } finally { live.close(); }
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ host: sample.host + sample.host_tail,
      agent: sample.prefix.trimStart() + sample.next, voice_reply: "agent:" + sample.agent_start });
  }
});

test("a plan proposal goes through the controller and the model is told exactly what was saved", async () => {
  const f = setup(() => ({ phase: "proposed", proposal, turn_id: "turn-1" }));
  await f.host("Research jk-ai.in for a bank pitch about me.", 100);
  await f.tool("propose_research", { subject: "Jyothi Kumar", audience: "his new team", outcome: "know his background", deliverable: "a short self-introduction deck", summary: proposal.summary, queries: [], urls: proposal.urls });
  expect(f.acted).toEqual([{ message: "Research jk-ai.in for a bank pitch about me.",
    action: { kind: "propose_research", goal: "Jyothi Kumar", summary: proposal.summary, queries: [], urls: proposal.urls,
      intent: { subject: "Jyothi Kumar", audience: "his new team", outcome: "know his background", deliverable: "a short self-introduction deck" } } }]);
  const [output, next] = f.sent;
  expect(output.item?.call_id).toBe("call-1");
  expect(output.item?.output).toContain(proposal.summary);
  expect(next).toEqual({ type: "response.create" });
  f.live.close();
});

test("a plan counts as heard only when the host spoke after the agent finished reading it", async () => {
  const interrupted = setup(() => ({ phase: "proposed", proposal, turn_id: "turn-1" }));
  await interrupted.host("Research jk-ai.in", 100);
  await interrupted.tool("propose_research", { subject: "Jyothi Kumar", audience: "his new team", outcome: "know his background", deliverable: "a short self-introduction deck", summary: proposal.summary, queries: [], urls: [] });
  await interrupted.agent("Here is the plan: review jk-ai.in", 2000);
  await interrupted.host("yes", 2100);
  expect(interrupted.heard).toEqual([]);
  interrupted.live.close();

  const listened = setup(() => ({ phase: "proposed", proposal, turn_id: "turn-1" }));
  await listened.host("Research jk-ai.in", 100);
  await listened.tool("propose_research", { subject: "Jyothi Kumar", audience: "his new team", outcome: "know his background", deliverable: "a short self-introduction deck", summary: proposal.summary, queries: [], urls: [] });
  await listened.agent("Here is the plan: review jk-ai.in. Shall I start?", 2000);
  await listened.host("yes", 2600);
  expect(listened.heard).toEqual(["plan-1/turn-1"]);
  listened.live.close();
});

test("once research starts, the agent says its closing line and the call ends", async () => {
  const f = setup(() => ({ phase: "researching", activity: { tool: "queue_research", status: "queued", result: "" } }));
  await f.host("Yes, go ahead.", 100);
  await f.tool("start_research", {});
  expect(f.sent[0].item?.output).toContain("Research has started");
  await f.agent("Starting now, I'll let you know when it's ready.", 900);
  await pause();
  expect(f.closed()).toBe(1);
  expect(f.recorded.map(exchange => exchange.host)).toEqual(["Yes, go ahead."]);
});

test("a malformed tool call never reaches the controller", async () => {
  const f = setup();
  await f.host("Research it", 100);
  await f.tool("propose_research", { summary: 42 });
  await f.tool("delete_everything", {}, "call-2");
  expect(f.acted).toEqual([]);
  expect(f.sent.filter(event => event.item).map(event => event.item!.output)).toEqual([
    "Not done: the request was incomplete. Ask the host for what is missing.", "Not done: that action is not available."]);
  f.live.close();
});

test("a short backchannel while the host pauses does not split the host's turn", async () => {
  const f = setup();
  await f.host("My website is JKAI dot in.", 2600);
  await f.agent("Got it.", 7000);
  await f.host(" I want to pitch my AI consulting firm to a bank.", 7900);
  await f.agent("Which bank's innovation team are you aiming at?", 12000);
  await f.host("HDFC.", 17000);
  expect(f.recorded).toEqual([{ host: "My website is JKAI dot in. I want to pitch my AI consulting firm to a bank.",
    agent: "Which bank's innovation team are you aiming at?", voice_items: ["live:2600"] }]);
  f.live.close();
});

test("a typed turn or button click first saves the voice exchange in progress, so saved order matches spoken order", async () => {
  const f = setup();
  await f.host("I'll give you a website. It is JK hyphen AI dot in.", 1000);
  await f.agent("Thanks. Shall I start the research?", 4000);
  f.live.flush();
  expect(f.recorded).toEqual([{ host: "I'll give you a website. It is JK hyphen AI dot in.", agent: "Thanks. Shall I start the research?", voice_items: ["live:1000"] }]);
  await pause();
  expect(f.recorded).toHaveLength(1);
  f.live.close();
});

test("sideband replay preserves verbatim multilingual fragments and call-scoped host and agent identifiers", async () => {
  const recorded: TLiveExchange[] = [];
  const live = create_live_interviewer({
    send: () => {}, close: () => {}, record: turn => recorded.push(turn), caption_scope: "fixture-lease",
    act: () => { throw new Error("A caption may not act"); }, heard: () => {},
  });
  const input = { type: "session.input_transcript.delta", event_id: "input-first", delta: "నేను pitch చేస్తున్నా", start_ms: 100, end_ms: 450 };
  await live.receive(input);
  await live.receive(input);
  await live.receive({ type: "session.output_transcript.delta", event_id: "reply-first", delta: "సరే, tell me more.", start_ms: 400, end_ms: 620 });
  await live.receive({ ...input, event_id: "input-tail", delta: ".", start_ms: 430, end_ms: 490 });
  live.close();
  expect(recorded).toHaveLength(1);
  expect(recorded[0]).toMatchObject({
    host: "నేను pitch చేస్తున్నా.", agent: "సరే, tell me more.",
    voice_items: ["live:fixture-lease:100"], voice_reply: "agent:fixture-lease:400",
  });
});

const first_spoken_approval = async (start_ms: number, end_ms: number, budget: string | null = "two US dollars", translated_outcome?: string) => {
  const db = new SessionStore(":memory:");
  const session = "timed-first-approval";
  const jobs: string[] = [];
  const outputs: TSent[] = [];
  const live = create_live_interviewer({
    send: event => outputs.push(event as TSent), close: () => {},
    record: exchange => { record_voice_exchange(db, session, exchange); },
    act: (message, action) => apply_voice_action(db, session, message, action,
      { ensure_research: () => {}, wake: job => jobs.push(job) }),
    heard: (proposal_id, turn_id) => { db.studio.hear_proposal(session, proposal_id, turn_id); },
  });
  const call = (name: string, args: object, delegation_id: string) => live.receive({
    type: "response.event", delegation_id, event: { type: "response.output_item.done", item: {
      type: "function_call", call_id: delegation_id, name, arguments: JSON.stringify(args),
    } },
  });
  try {
    await live.receive({ type: "session.input_transcript.delta", start_ms: 150, end_ms: 2000,
      delta: "Research my website jk-ai.in for a bank pitch to my new team." });
    await call("propose_research", { subject: "Portfolio", audience: "Bank team", outcome: "Know the host's background",
      deliverable: "Introductory deck", summary: proposal.summary, urls: proposal.urls, queries: [] }, "offer");
    const offered_turn = studio_context(db, session).state.proposal_turn_id;
    await live.receive({ type: "session.output_transcript.delta", start_ms: 2500, end_ms: 4350,
      delta: "I'll research jk-ai.in for your bank pitch to your new team. " + (translated_outcome ?? (budget
        ? `I’ll create six slides using public sources. The budget is ${budget} and ten minutes. ` : "")) + "Shall I start?" });
    await live.receive({ type: "session.delegation.created", offset_ms: 5200,
      delegation: { id: "first-approval", target: "responses" } });
    await call("start_research", {}, "first-approval");
    expect(studio_context(db, session).state.proposal_turn_id).toBe(offered_turn);
    expect(jobs).toHaveLength(0);
    await live.receive({ type: "session.input_transcript.delta", start_ms, end_ms, delta: "Yes, go ahead." });
    return { jobs, outputs, phase: studio_context(db, session).state.phase };
  } finally { live.close(); }
};

test("one spoken approval starts once when the correlated tool arrives before its transcript", async () => {
  const result = await first_spoken_approval(4480, 5080);
  expect(result.phase).toBe("researching");
  expect(result.jobs).toHaveLength(1);
  expect(result.outputs.at(-2)?.item?.output).toContain("Research has started");
});

test("the spoken plan can be read back with Hindi or Telugu quantities and source scope", async () => {
  for (const translated of [
    "सार्वजनिक स्रोत से छह स्लाइड। बजट २ अमेरिकी डॉलर और दस मिनट। ",
    "పబ్లిక్ వెబ్ నుంచి ఆరు స్లైడ్లు. బడ్జెట్ ౨ డాలర్లు, పది నిమిషాలు. ",
  ]) {
    const result = await first_spoken_approval(4480, 5080, null, translated);
    expect(result.jobs).toHaveLength(1);
    expect(result.phase).toBe("researching");
  }
});

test("speaking after the research summary cannot approve a mission whose outcome details were not read", async () => {
  for (const budget of [null, "$20", "12 US dollars"]) {
    const result = await first_spoken_approval(4480, 5080, budget);
    expect(result.phase).toBe("proposed");
    expect(result.jobs).toHaveLength(0);
    expect(result.outputs.at(-2)?.item?.output).toContain("The spoken approval could not be confirmed");
  }
});

test("a spoken plan correction waits for its late transcript and matches the captured mission revision", async () => {
  const run = async (revised: boolean) => {
    let mission = { mission_id: "mission-1", revision: 2 };
    const actions: { message: string; action: TVoiceAction; mission?: TMissionTurnBasis }[] = [];
    const live = create_live_interviewer({ send: () => {}, close: () => {}, heard: () => {}, record: () => {},
      mission_version: () => mission, idle_ms: 50, act: (message, action, basis) => {
        actions.push({ message, action, mission: basis });
        return { turn_id: "fixture", created_at: 0, user_text: message, text: "Review and approve the revised presentation plan in Mission.",
          language: "en", phase: "researching", proposal: null };
      } });
    try {
      await live.receive({ type: "session.delegation.created", offset_ms: 1300, delegation: { id: "late-revision", target: "responses" } });
      await live.receive({ type: "response.event", delegation_id: "late-revision", event: { type: "response.output_item.done", item: {
        type: "function_call", call_id: "late-tool", name: "mission_command", arguments: JSON.stringify({ slide_count: 4,
          audience: null, purpose: null, tone: null, add_host_fact: "I use a secure sandbox", files_only: null }),
      } } });
      expect(actions).toHaveLength(0);
      if (revised) mission = { mission_id: "mission-1", revision: 3 };
      await live.receive({ type: "session.input_transcript.delta", start_ms: 700, end_ms: 1000, delta: "Make four slides and add that " });
      await live.receive({ type: "session.input_transcript.delta", start_ms: 1000, end_ms: 1200, delta: "I use a secure sandbox." });
      await pause(35);
      return actions;
    } finally { live.close(); }
  };
  expect(await run(false)).toEqual([{ message: "Make four slides and add that I use a secure sandbox.",
    action: { kind: "mission_command", patch: { slide_count: 4, add_host_fact: "I use a secure sandbox" } },
    mission: { mission_id: "mission-1", revision: 2 } }]);
  expect(await run(true)).toEqual([]);
});

test("speech overlapping the plan or arriving after a different delegation cannot release a pending start", async () => {
  for (const [start, end] of [[4010, 4800], [5300, 5650]]) {
    const result = await first_spoken_approval(start, end);
    expect(result.phase).toBe("proposed");
    expect(result.jobs).toHaveLength(0);
    expect(result.outputs.at(-2)?.item?.output).toContain("The spoken approval could not be confirmed");
  }
});
