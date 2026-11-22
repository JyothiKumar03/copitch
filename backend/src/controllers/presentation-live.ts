import { createHash } from "node:crypto";
import type { Response } from "express";
import { AppError } from "../errors/app-error";
import { session_for } from "../middleware/host-session";
import { presentation_snapshot } from "../repositories/presentation-live";
import type { TPresentationRoute } from "../repositories/presentation-live";
import { database } from "../repositories/store";
import { call_voice_worker } from "../services/interview-voice";
import { upcoming_narration } from "../services/presentation-live";
import { check_live_answer, classify_live_turn, live_context } from "../services/live-turn";
import { verify_presentation_claims } from "../services/presentation-grounding";
import type { TPresentationClaim } from "../services/presentation-grounding";
import { numeric_tokens, prepare_presentation_edit, presentation_claim_evidence, presentation_edit_claims } from "../services/presentation-edit";
import type { TApiRequest } from "../types/http";
import type { TLiveDecision, TLiveModel, TLiveTurnContext } from "../types/live-turn";
import { presentation_command, presentation_microphone_offer, presentation_paint, presentation_start, presentation_turn } from "../types/presentation-live";
import type { TPresentationPin, TPresentationState, TPresentationTurn } from "../types/presentation-live";
import type { TResearchBundle } from "../types/research";

const host = (req: TApiRequest, res: Response) => {
  res.set("Cache-Control", "private, no-store");
  const session = session_for(req);
  if (!session) throw new AppError(401, "Unauthorized");
  return session;
};

export const read_presentation = (req: TApiRequest, res: Response) => {
  const session = host(req, res);
  const store = database().presentations;
  store.refresh_stage(session, req.params.deck_id);
  const { state } = store.current(session, req.params.deck_id);
  return res.json(presentation_snapshot(state));
};

export const start_live_presentation = (req: TApiRequest, res: Response) => {
  const session = host(req, res);
  const input = presentation_start.safeParse(req.body);
  if (!input.success) throw new AppError(400, "Approve the reviewed revision before presenting");
  return res.json(database().presentations.start(session, req.params.deck_id, input.data.revision));
};

export const open_presentation_stage = (req: TApiRequest, res: Response) => {
  const session = host(req, res);
  return res.json(database().presentations.stage(session, req.params.deck_id));
};

export const command_presentation = (req: TApiRequest, res: Response) => {
  const session = host(req, res);
  const input = presentation_command.safeParse(req.body);
  if (!input.success) throw new AppError(400, "Invalid presentation command");
  return res.json(database().presentations.command(session, req.params.deck_id, input.data));
};

export const paint_presentation = (req: TApiRequest, res: Response) => {
  res.set("Cache-Control", "no-store");
  const token = req.get("Authorization")?.match(/^Bearer ([\w-]{43})$/u)?.[1];
  if (!token) throw new AppError(401, "Audience link is invalid or has expired");
  const input = presentation_paint.safeParse(req.body);
  if (!input.success) throw new AppError(400, "Invalid audience paint acknowledgement");
  database().presentations.paint(token, input.data);
  return res.sendStatus(204);
};

export const presentation_audio = (fetch_worker = fetch) => async (req: TApiRequest, res: Response) => {
  const session = host(req, res);
  const db = database();
  db.presentations.refresh_stage(session, req.params.deck_id);
  const { state, deck } = db.presentations.current(session, req.params.deck_id);
  const attempt = state.attempt;
  if (!attempt || attempt.attempt_id !== req.params.attempt_id) throw new AppError(409, "This playback attempt already changed");
  if (attempt.text.length > 4000) throw new AppError(422, "Split this narration sentence into shorter sentences");
  // Generate the next sentences now. The voice worker caches by text, so their own requests return without a gap.
  for (const text of upcoming_narration(state, deck, 2)) {
    if (text.length <= 4000) void call_voice_worker("speech", "application/json", JSON.stringify({ text }), fetch_worker).catch(() => {});
  }
  const abort = new AbortController();
  res.once("close", () => { if (!res.writableEnded) abort.abort(); });
  const audio = await call_voice_worker("speech", "application/json", JSON.stringify({ text: attempt.text }), fetch_worker, undefined, abort.signal);
  if (audio.kind !== "audio") throw new AppError(502, "Presentation audio was unavailable");
  db.presentations.refresh_stage(session, req.params.deck_id);
  const latest = db.presentations.current(session, req.params.deck_id).state;
  if (latest.attempt?.attempt_id !== attempt.attempt_id) throw new AppError(409, "This playback attempt already changed");
  return res.type("audio/mpeg").send(Buffer.from(audio.bytes));
};

export const presentation_microphone = (fetch_worker = fetch) => {
  const opening = new Set<string>();
  return async (req: TApiRequest, res: Response) => {
    const session = host(req, res);
    const offer = presentation_microphone_offer.safeParse(req.body);
    if (!offer.success) throw new AppError(400, "Invalid presentation microphone offer");
    const deck_id = req.params.deck_id;
    const store = database().presentations;
    const verify_revision = () => {
      const { state } = store.current(session, deck_id);
      if (state.revision !== offer.data.revision || state.status === "completed") {
        throw new AppError(409, "Open the current presentation before turning on the room microphone");
      }
    };
    verify_revision();
    if (opening.has(session)) throw new AppError(429, "The room microphone is already connecting");
    const abort = new AbortController();
    const disconnect = () => { if (!res.writableEnded) abort.abort(); };
    opening.add(session);
    res.once("close", disconnect);
    try {
      const safety_identifier = createHash("sha256").update(session).digest("hex");
      const answer = await call_voice_worker("presentation-connect", "application/json",
        JSON.stringify({ sdp: offer.data.sdp, safety_identifier }), fetch_worker, undefined, abort.signal);
      if (answer.kind !== "sdp") throw new AppError(502, "Realtime microphone signaling was unavailable");
      verify_revision();
      return res.type("application/sdp").send(answer.sdp);
    } finally {
      res.off("close", disconnect);
      opening.delete(session);
    }
  };
};

const clarify = (text: string): TPresentationRoute => ({ kind: "reply", reply: { kind: "clarify", text } });
const route_turn = (turn: TPresentationTurn, pin: TPresentationPin, decision: TLiveDecision,
  context: TLiveTurnContext, research: TResearchBundle, has_independent_review: boolean): TPresentationRoute => {
  const checked = check_live_answer(decision, context);
  if (checked.kind === "ignore") return { kind: "ignore" };
  if (checked.kind === "control") {
    if (checked.command === "approve" || checked.command === "reject") return clarify("Use the private review buttons to decide this change.");
    if (checked.command === "go_to") {
      if (!checked.slide_id || !context.presentation?.slide_choices.some(slide => slide.slide_id === checked.slide_id)) return clarify("Which slide should I show?");
      return { kind: "control", action: { kind: "go_to", slide_id: checked.slide_id } };
    }
    return { kind: "control", action: { kind: checked.command } };
  }
  if (checked.kind === "answer") {
    const known = numeric_tokens(checked.citations?.map(citation => citation.excerpt) ?? []);
    // A reformatted amount or period can proceed only through independent claim verification.
    if (!has_independent_review && [...numeric_tokens([checked.text])].some(value => !known.has(value))) {
      return clarify("The available sources do not give that number. Which source should I use?");
    }
    return { kind: "reply", reply: checked };
  }
  if (checked.kind !== "edit") return { kind: "reply", reply: checked };
  const result = prepare_presentation_edit({ turn_id: turn.turn_id, base_revision: pin.revision, slide_id: pin.slide_id,
    message: turn.message }, checked, context, research);
  return result.kind === "edit" ? result : clarify(result.text);
};

const claims_for = (route: TPresentationRoute, context: TLiveTurnContext): TPresentationClaim[] => {
  if (route.kind === "reply" && route.reply.kind === "answer") return [{ text: route.reply.text, support: route.reply.citations ?? [] }];
  if (route.kind !== "edit") return [];
  return presentation_edit_claims(route, context);
};

export const presentation_turn_handler = (model: TLiveModel = classify_live_turn,
  verify = model === classify_live_turn ? verify_presentation_claims : undefined) => {
  const pending = new Map<string, { signature: string; result: Promise<TPresentationState> }>();
  return async (req: TApiRequest, res: Response) => {
    const session = host(req, res);
    const parsed = presentation_turn.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, "Invalid pinned presentation turn");
    const turn = parsed.data;
    const deck_id = req.params.deck_id;
    const key = JSON.stringify([session, deck_id, turn.turn_id]);
    const signature = JSON.stringify(turn);
    const running = pending.get(key);
    if (running) {
      if (running.signature !== signature) throw new AppError(409, "This turn ID identifies another message");
      return res.json(await running.result);
    }
    const db = database();
    const run = db.presentations.begin_turn(session, deck_id, turn);
    if ("complete" in run) return res.json(run.complete);
    const slide = run.deck.slides.find(item => item.slide_id === run.pin.slide_id);
    const research = db.research_for_deck(session, run.deck);
    if (!slide || !research) return res.json(db.presentations.finish_turn(session, deck_id, turn, clarify("The slide’s original research is unavailable.")));
    const context = { ...live_context(run.deck, slide, { turn_id: turn.turn_id, base_revision: run.pin.revision, slide_id: run.pin.slide_id, message: turn.message },
      research, db.presentations.recent_turns(session, deck_id, run.pin.revision)), presentation: {
      sentence_index: run.pin.sentence_index, pending_review: run.pending_review,
      slide_choices: run.deck.slides.map(item => ({ slide_id: item.slide_id, title: item.title })),
    } };
    let ordinal = 0;
    const signal = AbortSignal.timeout(35_000);
    const on_attempt: NonNullable<Parameters<TLiveModel>[2]> = attempt => db.presentations.model_attempt(session, deck_id, turn.turn_id, ++ordinal, attempt);
    const result = model(context, signal, on_attempt)
      .then(decision => route_turn(turn, run.pin, decision, context, research, !!verify))
      .then(async route => {
        if (!verify) return route;
        const claims = claims_for(route, context);
        if (!claims.length) return route;
        const latest = db.presentations.current(session, deck_id).state;
        if (latest.pin?.pin_id !== turn.pin_id || latest.pending_turn !== turn.turn_id) return route;
        const evidence = presentation_claim_evidence(claims, research, turn.message);
        return await verify(claims, evidence, signal, on_attempt) ? route : clarify("The available sources don’t verify that wording. Can you give an exact statement or source?");
      })
      .catch(error => {
        if (process.env.TRACE_LOGS === "1") console.log(JSON.stringify({
          operation: "presentation.turn_failure", turn_id: turn.turn_id,
          error_kind: error instanceof Error ? error.name : "unknown",
          ...(error instanceof AppError && { status: error.status }),
        }));
        return clarify("I couldn't confirm that request. You can ask again or use the presentation controls.");
      })
      .then(reply => db.presentations.finish_turn(session, deck_id, turn, reply)).finally(() => pending.delete(key));
    pending.set(key, { signature, result });
    return res.json(await result);
  };
};
