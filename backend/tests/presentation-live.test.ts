import { expect, test } from "bun:test";
import { create_api } from "../src/app";
import { presentation_audio, presentation_turn_handler } from "../src/controllers/presentation-live";
import { api_error } from "../src/middleware/api-error";
import { stage_paint_lease_ms } from "../src/repositories/presentation-live";
import { database } from "../src/repositories/store";
import { accounts } from "../src/routes/accounts";
import { audience } from "../src/routes/audience";
import { create_deck_router } from "../src/routes/deck";
import type { TDeck } from "../src/types/deck";
import type { TPresentationAction, TPresentationState } from "../src/types/presentation-live";
import type { TResearchBrief } from "../src/types/research";
import { serve_api } from "./helpers/serve-api";

test("signed-in presentation fences stale speech, pins Q&A and publishes only approved edits before advancing", async () => {
  process.env.AI_SESSION_DB = ":memory:";
  const token_before = process.env.VOICE_WORKER_TOKEN;
  process.env.VOICE_WORKER_TOKEN = "fixture-worker-token";
  let model_calls = 0;
  const spoken: string[] = [];
  const classifier_started = Promise.withResolvers<void>();
  const release_classification = Promise.withResolvers<void>();
  const verified_text: string[][] = [];
  const fixture = create_api();
  fixture.use("/api", accounts, audience);
  fixture.use("/api/sessions", create_deck_router(presentation_turn_handler(async context => {
    model_calls++;
    expect(context.slide.slide_id).toBe("intro");
    expect(context.presentation?.sentence_index).toBe(1);
    if (context.message.startsWith("Where, delayed")) {
      classifier_started.resolve();
      await release_classification.promise;
    }
    if (context.message.startsWith("Where")) return { kind: "answer", text: "He studied at KMIT.",
      support: [{ evidence_id: "P1", excerpt: "studied at KMIT" }] };
    return { kind: "edit", text: "I drafted one addition.", changes: {
      highlights: ["Built production agents", "Processed 30k+ calls"],
      narration: "First sentence. Second sentence. The pipeline processed 30k+ calls.",
      ...(context.message.startsWith("Please") && { template: { type: "metric_grid" as const, metrics: [{ label: "processed", value: "30k+" }] } }),
    }, support: [{ evidence_id: "P2", excerpt: "processed 30k+ calls" }] };
  }, async (claims, evidence) => {
    expect(evidence.every(row => claims.some(claim => claim.support.some(ref => ref.evidence_id === row.id)))).toBe(true);
    verified_text.push(claims.map(claim => claim.text));
    return true;
  }), presentation_audio(async (_url, options) => {
    expect(new Headers(options?.headers).get("Authorization")).toBe("Bearer fixture-worker-token");
    spoken.push(JSON.parse(String(options?.body)).text);
    return new Response(new Uint8Array([0x49, 0x44, 0x33, 0x00]), { headers: { "Content-Type": "audio/mpeg" } });
  })));
  fixture.use(api_error);
  await using http = await serve_api(fixture);
  let cookie = "";
  const send = (path: string, body?: unknown, token?: string) => http.request(path, {
    method: body === undefined ? "GET" : "POST",
    headers: { ...(token ? { Authorization: "Bearer " + token } : cookie ? { Cookie: cookie } : {}),
      ...(body !== undefined && { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  try {
    const id = { email: `${crypto.randomUUID()}@example.test`, password: crypto.randomUUID() };
    cookie = (await send("/api/account/register", id)).headers.get("set-cookie")!.split(";", 1)[0];
    const { session_id } = await (await send("/api/projects", { name: "Presentation rehearsal" })).json();
    const db = database();
    const research_id = crypto.randomUUID();
    const brief: TResearchBrief = { brief_id: crypto.randomUUID(), summary: "Team introduction", messages: [], materials: "",
      source_policy: "files_only", urls: [], public_queries: [], question: null };
    expect(db.replace_brief(session_id, undefined, brief)).toBe(true);
    expect(db.save_research(session_id, { research_id, confirmed_brief: brief, brief_id: brief.brief_id,
      markdown: "Private notes", gaps: [], findings: { title: "Introduction", sections: [] }, evidence: [
        { id: "P1", origin: "public", location: "Education", url: "https://example.org/education", passage: "He studied at KMIT." },
        { id: "P2", origin: "public", location: "Projects", url: "https://example.org/projects", passage: "The pipeline processed 30k+ calls." },
      ] })).toBe(true);
    const deck: TDeck = { deck_id: crypto.randomUUID(), research_id, revision: 1, title: "Introduction", slides: [
      { slide_id: "intro", layout: "headline", template: { type: "title_card" }, title: "Projects", highlights: ["Built production agents"],
        narration: "First sentence. Second sentence.", evidence_ids: ["P1"], sentences: [
          { sentence_id: "intro-0", text: "First sentence.", evidence_ids: ["P1"] },
          { sentence_id: "intro-1", text: "Second sentence.", evidence_ids: ["P1"] },
        ] },
      { slide_id: "close", layout: "takeaway", title: "Takeaway", highlights: ["Ask questions"], narration: "Wrap up.", evidence_ids: ["P1"] },
    ] };
    db.decks.create(session_id, deck);
    const base = `/api/sessions/${session_id}/decks/${deck.deck_id}`;
    const live = base + "/live";
    const action = (state: TPresentationState, action: TPresentationAction, event_id = crypto.randomUUID()) =>
      send(live + "/commands", { event_id, revision: state.revision, generation: state.generation, action });
    const command = async (state: TPresentationState, type: TPresentationAction, event_id?: ReturnType<typeof crypto.randomUUID>): Promise<TPresentationState> => {
      const reply = await action(state, type, event_id);
      expect(reply.status).toBe(200);
      return reply.json();
    };
    const read = async (): Promise<TPresentationState> => (await send(live)).json();
    const paint = (state: TPresentationState, token: string) => send("/api/audience/paint", {
      sequence: state.stage_sequence, revision: state.revision, slide_id: state.cursor.slide_id,
    }, token);
    const complete = async (state: TPresentationState) => {
      const attempt_id = state.attempt!.attempt_id;
      const playing = await command(state, { kind: "playing", attempt_id });
      return command(playing, { kind: "ended", attempt_id });
    };
    const send_turn = (state: TPresentationState, message: string, turn_id = crypto.randomUUID()) => send(live + "/turns", {
      turn_id, pin_id: state.pin!.pin_id, message,
    });

    const list = await (await send(`/api/sessions/${session_id}/decks?research_id=${research_id}`)).json();
    expect(list.decks).toEqual([{ deck_id: deck.deck_id, label: "Introduction" }]);
    expect((await send(live + "/start", { revision: 1, approved: false })).status).toBe(400);
    const old_audience = `/api/sessions/${session_id}/audience/`;
    const draft = { deck_id: deck.deck_id, revision: 1, slide_id: "intro" };
    expect((await send(old_audience + "open", draft)).status).toBe(409);
    expect((await send(old_audience + "publish", { ...draft, expected_sequence: 1 })).status).toBe(409);
    const started = await (await send(live + "/start", { revision: 1, approved: true })).json();
    let state = started.state as TPresentationState;
    const token = started.stage.token as string;
    expect(state.status).toBe("awaiting_paint");
    expect(state.attempt).toBeNull();
    const public_frame = await (await send("/api/audience", undefined, token)).json();
    expect(public_frame.slide.template).toEqual({ type: "title_card" });
    expect(public_frame.slide.narration).toBeUndefined();
    expect(public_frame.slide.sentences).toBeUndefined();
    expect((await paint({ ...state, stage_sequence: state.stage_sequence + 1 }, token)).status).toBe(409);
    expect((await paint(state, token)).status).toBe(204);
    state = await read();
    const first_sound = state.attempt!;
    expect(first_sound.text).toBe("First sentence.");
    expect((await send(live + "/audio/" + first_sound.attempt_id, undefined, token)).status).toBe(401);
    expect((await send(live + "/audio/" + first_sound.attempt_id)).headers.get("content-type")).toContain("audio/mpeg");
    expect(spoken).toEqual(["First sentence."]);
    state = await complete(state);
    expect(state.cursor).toEqual({ slide_id: "intro", sentence_index: 1 });
    const second = state.attempt!.attempt_id;
    state = await command(state, { kind: "interrupt", attempt_id: second });
    expect(state.pin?.sentence_index).toBe(1);
    expect((await action(state, { kind: "ended", attempt_id: second })).status).toBe(409);
    const question_id = crypto.randomUUID();
    const [answer, duplicate] = await Promise.all([send_turn(state, "Where did he study?", question_id), send_turn(state, "Where did he study?", question_id)]);
    expect(answer.status).toBe(200);
    expect(duplicate.status).toBe(200);
    state = await answer.json();
    expect(state.last_reply).toMatchObject({ kind: "answer", citations: [{ evidence_id: "P1", excerpt: "studied at KMIT" }] });
    expect(model_calls).toBe(1);
    expect(state.attempt?.kind).toBe("answer");
    state = await complete(state);
    expect(state.attempt?.text).toBe("Second sentence.");
    expect(state.attempt?.attempt_id).not.toBe(second);
    expect(verified_text).toEqual([["He studied at KMIT."]]);

    state = await command(state, { kind: "interrupt", attempt_id: state.attempt!.attempt_id });
    const displaced = send_turn(state, "Where, delayed, did he study?");
    await classifier_started.promise;
    state = await command(state, { kind: "interrupt" });
    release_classification.resolve();
    expect((await displaced).status).toBe(409);
    expect((await read()).pin?.pin_id).toBe(state.pin?.pin_id);
    state = await (await send_turn(state, "Add that the pipeline processed 30k+ calls.")).json();
    expect(verified_text.at(-1)).toEqual(["Processed 30k+ calls", "The pipeline processed 30k+ calls."]);
    const first_proposal = state.proposal!;
    expect(first_proposal.attribution).toEqual([{ evidence_id: "P2", excerpt: "processed 30k+ calls" }]);
    expect(first_proposal.after.template).toEqual({ type: "title_card" });
    const rotated = await (await send(live + "/stage", {})).json();
    state = rotated.state;
    const new_token = rotated.stage.token as string;
    expect(state.proposal?.proposal_id).toBe(first_proposal.proposal_id);
    expect((await paint(state, token)).status).toBe(401);
    expect((await paint(state, new_token)).status).toBe(204);
    const reject = { kind: "decide", decision: "reject", proposal_id: first_proposal.proposal_id, slide_id: "intro" } as const;
    state = await command(await read(), reject);
    expect(state).toMatchObject({ status: "paused", revision: 1, cursor: { slide_id: "intro", sentence_index: 1 } });
    expect((await (await send("/api/audience", undefined, new_token)).json()).slide.highlights).toEqual(["Built production agents"]);

    state = await command(state, { kind: "interrupt" });
    state = await (await send_turn(state, "Please add that the pipeline processed 30k+ calls.")).json();
    expect(state.proposal?.after.template).toMatchObject({ type: "metric_grid", metrics: [{ label: "processed", value: "30k+" }] });
    const approve = { kind: "decide", decision: "approve", proposal_id: state.proposal!.proposal_id, slide_id: "intro" } as const;
    const decision_id = crypto.randomUUID();
    const before = state;
    state = await command(state, approve, decision_id);
    expect(await command(before, approve, decision_id)).toEqual(state);
    expect(state).toMatchObject({ painted: false, revision: 2, status: "awaiting_paint", cursor: { slide_id: "intro" }, attempt: null });
    const accepted_frame = await (await send("/api/audience", undefined, new_token)).json();
    expect(accepted_frame.slide.highlights).toContain("Processed 30k+ calls");
    expect(accepted_frame.slide.template.type).toBe("metric_grid");
    expect((await paint(before, new_token)).status).toBe(409);
    expect((await paint(state, new_token)).status).toBe(204);
    state = await read();
    expect(state.attempt).toMatchObject({ text: "The pipeline processed 30k+ calls.", kind: "accepted_edit" });
    const expired = await command(state, { kind: "playing", attempt_id: state.attempt!.attempt_id });
    db.presentations.refresh_stage(session_id, deck.deck_id, Date.now() + stage_paint_lease_ms + 1);
    state = await read();
    expect(state).toMatchObject({ painted: false, revision: 2, status: "awaiting_paint", cursor: { slide_id: "intro", sentence_index: 1 }, attempt: null });
    expect((await action(expired, { kind: "ended", attempt_id: expired.attempt!.attempt_id })).status).toBe(409);
    expect((await paint(expired, new_token)).status).toBe(409);
    expect((await paint(state, new_token)).status).toBe(204);
    state = await read();
    expect(state.attempt).toMatchObject({ text: "The pipeline processed 30k+ calls.", kind: "accepted_edit" });
    expect(state.attempt?.attempt_id).not.toBe(expired.attempt!.attempt_id);
    state = await complete(state);
    expect(state).toMatchObject({ painted: false, revision: 2, status: "awaiting_paint", cursor: { slide_id: "close", sentence_index: 0 }, attempt: null });
    expect((await paint(state, new_token)).status).toBe(204);
    state = await read();
    expect(state.attempt?.text).toBe("Wrap up.");
    cookie = (await send("/api/account/login", id)).headers.get("set-cookie")!.split(";", 1)[0];
    expect(await read()).toEqual(state);
    state = await command(state, { kind: "reconnect" });
    expect(state).toMatchObject({ status: "paused", attempt: null, cursor: { slide_id: "close", sentence_index: 0 } });
  } finally {
    if (token_before === undefined) delete process.env.VOICE_WORKER_TOKEN;
    else process.env.VOICE_WORKER_TOKEN = token_before;
  }
});
