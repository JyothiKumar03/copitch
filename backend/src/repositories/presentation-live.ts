import type { Database } from "bun:sqlite";
import { AppError } from "../errors/app-error";
import { apply_presentation_action, cue_presentation, essential_sentences, handle_presentation_paint,
  pause_presentation, rebind_stage, resting_presentation, start_presentation, stop_attempt } from "../services/presentation-live";
import type { TDeck, TEditProposal, TEditRequest } from "../types/deck";
import type { TAttempt } from "../types/ai";
import type { TLiveReply } from "../types/live-turn";
import type { TPresentationAction, TPresentationCommand, TPresentationPaint, TPresentationState,
  TPresentationStored, TPresentationTurn } from "../types/presentation-live";
import type { AudienceRepository } from "./audience";
import type { DeckRepository } from "./deck";

export type TPresentationRoute = { kind: "ignore" }
  | { kind: "control"; action: Extract<TPresentationAction, { kind: "pause" | "resume" | "next" | "back" | "skip" | "go_to" }> }
  | { kind: "reply"; reply: Exclude<TLiveReply, { kind: "edit" }> }
  | { kind: "edit"; text: string; request: TEditRequest; attribution: NonNullable<TEditProposal["attribution"]>; sources: NonNullable<TDeck["sources"]> };

export const presentation_snapshot = (state: TPresentationStored): TPresentationState => ({
  revision: state.revision, generation: state.generation, version: state.version, status: state.status,
  cursor: state.cursor, attempt: state.attempt, pin: state.pin, proposal: state.proposal,
  last_reply: state.last_reply, stage_sequence: state.stage_sequence, painted: state.painted,
});
export const stage_paint_lease_ms = 8000;

export class PresentationRepository {
  constructor(private db: Database, private decks: DeckRepository, private audience: AudienceRepository) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS live_presentations(session TEXT NOT NULL,deck TEXT NOT NULL,state TEXT NOT NULL,
        PRIMARY KEY(session,deck));
      CREATE TABLE IF NOT EXISTS live_presentation_commands(session TEXT NOT NULL,deck TEXT NOT NULL,id TEXT NOT NULL,request TEXT NOT NULL,
        PRIMARY KEY(session,deck,id));
      CREATE TABLE IF NOT EXISTS live_presentation_turns(seq INTEGER PRIMARY KEY,session TEXT NOT NULL,deck TEXT NOT NULL,id TEXT NOT NULL,
        revision INTEGER NOT NULL,request TEXT NOT NULL,reply TEXT, UNIQUE(session,deck,id));
      CREATE TABLE IF NOT EXISTS live_presentation_model_attempts(session TEXT NOT NULL,deck TEXT NOT NULL,turn TEXT NOT NULL,attempt INTEGER NOT NULL,
        result TEXT NOT NULL, PRIMARY KEY(session,deck,turn,attempt));
    `);
  }

  recover() {
    this.db.transaction(() => {
      const rows = this.db.query<{ session: string; deck: string; state: string }, []>("SELECT session,deck,state FROM live_presentations").all();
      for (const row of rows) {
        const state = JSON.parse(row.state) as TPresentationStored;
        pause_presentation(state);
        state.generation++;
        this.save(row.session, row.deck, state);
      }
    }).immediate();
  }

  get(session: string, deck: string): TPresentationStored | undefined {
    const row = this.db.query<{ state: string }, [string,string]>("SELECT state FROM live_presentations WHERE session=? AND deck=?").get(session, deck);
    return row ? JSON.parse(row.state) as TPresentationStored : undefined;
  }

  current(session: string, deck_id: string) {
    const deck = this.decks.get(session, deck_id);
    if (!deck) throw new AppError(404, "Unknown deck");
    const state = this.get(session, deck_id);
    if (!state) throw new AppError(404, "Approve and present the saved deck first");
    if (deck.revision !== state.revision) throw new AppError(409, "Review the new deck revision before presenting");
    return { deck, state };
  }

  private save(session: string, deck: string, state: TPresentationStored, changed = true) {
    if (changed) state.version++;
    this.db.query("INSERT OR REPLACE INTO live_presentations(session,deck,state) VALUES(?,?,?)").run(session, deck, JSON.stringify(state));
    return presentation_snapshot(state);
  }

  private publish_for(session: string) {
    return (deck: TDeck, slide_id: string, sequence: number) => this.audience.publish(session, deck, slide_id, sequence).sequence;
  }

  refresh_stage(session: string, deck_id: string, now = Date.now()) {
    return this.db.transaction(() => {
      const state = this.get(session, deck_id);
      if (!state?.painted || now - (state.stage_painted_at ?? 0) <= stage_paint_lease_ms) return;
      const deck = this.decks.get(session, deck_id, state.revision);
      if (!deck) return;
      stop_attempt(state);
      state.generation++;
      rebind_stage(state, this.publish_for(session)(deck, state.cursor.slide_id, state.stage_sequence));
      state.status = state.proposal ? "awaiting_decision" : state.pin ? "listening" : state.wants_playback ? "awaiting_paint" : resting_presentation(state, deck);
      this.save(session, deck_id, state);
    }).immediate();
  }

  refresh_token_stage(token: string) {
    const scope = this.audience.scope(token);
    if (scope) this.refresh_stage(scope.session, scope.deck);
  }

  start(session: string, deck_id: string, revision: number) {
    return this.db.transaction(() => {
      const deck = this.decks.get(session, deck_id);
      if (!deck) throw new AppError(404, "Unknown deck");
      if (deck.revision !== revision) throw new AppError(409, "Review the current deck revision before presenting");
      const previous = this.get(session, deck_id);
      const existing = previous?.revision === revision ? previous : null;
      const slide_id = existing?.cursor.slide_id ?? deck.slides[0]?.slide_id;
      if (!slide_id) throw new AppError(409, "The deck needs a slide before presenting");
      const stage = this.audience.open(session, deck, slide_id, true);
      const state = existing ?? start_presentation(session, deck, stage.sequence);
      if (existing) {
        pause_presentation(state);
        state.generation++;
        rebind_stage(state, stage.sequence);
      } else if (previous) {
        state.generation = previous.generation + 1;
        state.version = previous.version;
      }
      return { state: this.save(session, deck_id, state), stage };
    }).immediate();
  }

  stage(session: string, deck_id: string) {
    return this.db.transaction(() => {
      const { deck, state } = this.current(session, deck_id);
      const wants_playback = state.wants_playback;
      pause_presentation(state);
      state.wants_playback = wants_playback;
      state.generation++;
      const stage = this.audience.open(session, deck, state.cursor.slide_id, true);
      rebind_stage(state, stage.sequence);
      cue_presentation(state, deck, this.publish_for(session));
      return { state: this.save(session, deck_id, state), stage };
    }).immediate();
  }

  paint(token: string, paint: TPresentationPaint) {
    this.refresh_token_stage(token);
    return this.db.transaction(() => {
      const scope = this.audience.scope(token);
      if (!scope) throw new AppError(401, "Audience link is invalid or has expired");
      const { deck, state } = this.current(scope.session, scope.deck);
      if (state.painted && state.stage_sequence === paint.sequence && state.revision === paint.revision && state.cursor.slide_id === paint.slide_id) {
        state.stage_painted_at = Date.now();
        this.save(scope.session, scope.deck, state, false);
        return;
      }
      handle_presentation_paint(state, deck, paint, this.publish_for(scope.session));
      if (state.painted) state.stage_painted_at = Date.now();
      this.save(scope.session, scope.deck, state);
    }).immediate();
  }

  command(session: string, deck_id: string, command: TPresentationCommand) {
    this.refresh_stage(session, deck_id);
    return this.db.transaction(() => {
      const { deck, state } = this.current(session, deck_id);
      const signature = JSON.stringify(command);
      const duplicate = this.db.query<{ request: string }, [string,string,string]>(
        "SELECT request FROM live_presentation_commands WHERE session=? AND deck=? AND id=?").get(session, deck_id, command.event_id);
      if (duplicate) {
        if (duplicate.request !== signature) throw new AppError(409, "Command ID already identifies a different request");
        return presentation_snapshot(state);
      }
      if (state.revision !== command.revision || state.generation !== command.generation) throw new AppError(409, "The presentation has moved on");
      if (command.action.kind === "decide") this.decide(session, deck, state, command.action);
      else apply_presentation_action(state, deck, command.action, this.publish_for(session));
      this.db.query("INSERT INTO live_presentation_commands VALUES(?,?,?,?)").run(session, deck_id, command.event_id, signature);
      return this.save(session, deck_id, state);
    }).immediate();
  }

  private decide(session: string, deck: TDeck, state: TPresentationStored, action: Extract<TPresentationAction, { kind: "decide" }>) {
    const proposal = state.proposal;
    if (!proposal || proposal.proposal_id !== action.proposal_id || proposal.slide_id !== action.slide_id ||
        proposal.slide_id !== state.cursor.slide_id || proposal.base_revision !== state.revision) {
      throw new AppError(409, "Approve the proposal for this slide and revision");
    }
    const decided = this.decks.decide(session, deck.deck_id, proposal.proposal_id, action.decision);
    state.proposal = null;
    state.last_reply = null;
    pause_presentation(state);
    if (action.decision === "reject") return;
    const revised = this.decks.get(session, deck.deck_id, decided.approved_revision!)!;
    state.revision = revised.revision;
    state.generation++;
    state.wants_playback = true;
    state.status = "awaiting_paint";
    const stage_sequence = this.publish_for(session)(revised, state.cursor.slide_id, state.stage_sequence);
    state.pending_advance = { revision: revised.revision, stage_sequence, next: 0,
      sentences: essential_sentences(proposal.before, proposal.after) };
    rebind_stage(state, stage_sequence);
  }

  begin_turn(session: string, deck_id: string, turn: TPresentationTurn) {
    this.refresh_stage(session, deck_id);
    return this.db.transaction(() => {
      const { deck, state } = this.current(session, deck_id);
      const prior = this.db.query<{ request: string; reply: string | null }, [string,string,string]>(
        "SELECT request,reply FROM live_presentation_turns WHERE session=? AND deck=? AND id=?").get(session, deck_id, turn.turn_id);
      if (prior) {
        if (prior.request !== JSON.stringify(turn)) throw new AppError(409, "Turn ID already identifies another message");
        if (prior.reply !== null) return { complete: presentation_snapshot(state) };
        throw new AppError(409, "This turn is already running or was interrupted");
      }
      if (state.pin?.pin_id !== turn.pin_id || state.pending_turn) throw new AppError(409, "This spoken turn belongs to an older interruption");
      this.db.query("INSERT INTO live_presentation_turns(session,deck,id,revision,request) VALUES(?,?,?,?,?)")
        .run(session, deck_id, turn.turn_id, state.revision, JSON.stringify(turn));
      state.pending_turn = turn.turn_id;
      this.save(session, deck_id, state);
      return { deck, pin: state.pin, pending_review: !!state.proposal };
    }).immediate();
  }

  recent_turns(session: string, deck: string, revision: number) {
    const rows = this.db.query<{ request: string; reply: string }, [string,string,number]>(`
      SELECT request,reply FROM live_presentation_turns WHERE session=? AND deck=? AND revision=? AND reply IS NOT NULL ORDER BY seq DESC LIMIT 2`)
      .all(session, deck, revision);
    return rows.reverse().map(row => ({ message: (JSON.parse(row.request) as TPresentationTurn).message.slice(0, 400), response: row.reply.slice(0, 400) }));
  }

  model_attempt(session: string, deck: string, turn: string, ordinal: number, result: TAttempt) {
    this.db.query("INSERT OR IGNORE INTO live_presentation_model_attempts VALUES(?,?,?,?,?)").run(session, deck, turn, ordinal, JSON.stringify(result));
  }

  finish_turn(session: string, deck_id: string, turn: TPresentationTurn, result: TPresentationRoute) {
    this.refresh_stage(session, deck_id);
    return this.db.transaction(() => {
      const { deck, state } = this.current(session, deck_id);
      if (state.pin?.pin_id !== turn.pin_id || state.pending_turn !== turn.turn_id) throw new AppError(409, "A newer turn replaced this interruption");
      state.pin = null;
      state.pending_turn = null;
      state.last_reply = null;
      state.status = resting_presentation(state, deck);
      const publish = this.publish_for(session);
      if (result.kind === "control") {
        const original = structuredClone(state);
        try { apply_presentation_action(state, deck, result.action, publish); }
        catch (error) {
          if (!(error instanceof AppError) || error.status !== 409) throw error;
          Object.assign(state, original);
          result = { kind: "reply", reply: { kind: "clarify", text: error.message } };
        }
      }
      if (result.kind === "edit") {
        if (state.pending_advance) result = { kind: "reply", reply: { kind: "clarify", text: "Finish showing the accepted change before proposing another edit." } };
        else {
          const proposal = this.decks.propose(session, deck_id, result.request, { attribution: result.attribution, sources: result.sources });
          if (state.proposal) this.decks.decide(session, deck_id, state.proposal.proposal_id, "reject");
          state.proposal = proposal;
          state.status = "awaiting_decision";
          state.last_reply = { kind: "edit", text: result.text, proposal };
        }
      }
      if (result.kind === "reply") {
        state.last_reply = result.reply;
        if (result.reply.kind === "clarify") state.wants_playback = false;
        state.attempt = { attempt_id: crypto.randomUUID(), kind: "answer", text: result.reply.text };
        state.status = "answering";
      }
      cue_presentation(state, deck, publish);
      this.db.query("UPDATE live_presentation_turns SET reply=? WHERE session=? AND deck=? AND id=?")
        .run(state.last_reply?.text ?? "", session, deck_id, turn.turn_id);
      return this.save(session, deck_id, state);
    }).immediate();
  }
}
