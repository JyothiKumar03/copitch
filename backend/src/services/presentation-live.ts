import { AppError } from "../errors/app-error";
import type { TContinuationAction, TContinuationRole } from "../types/continuation";
import type { TDeck, TSlide } from "../types/deck";
import type { TPresentationAction, TPresentationPaint, TPresentationStored } from "../types/presentation-live";
import { apply_continuation, create_continuation } from "./continuation";

type TPublishSlide = (deck: TDeck, slide_id: string, expected_sequence: number) => number;
type TSentence = { sentence_id: string; text: string };
const splitter = new Intl.Segmenter(undefined, { granularity: "sentence" });

export const presentation_sentences = (slide: TSlide): TSentence[] => {
  const planned = slide.sentences;
  if (planned?.length && planned.map(sentence => sentence.text.trim()).join(" ") === slide.narration.trim().replace(/\s+/gu, " ")) return planned;
  return [...splitter.segment(slide.narration)].map(({ segment }, index) => ({
    sentence_id: `${slide.slide_id}:${index}`, text: segment.trim(),
  })).filter(sentence => sentence.text);
};

const cursor_slide = (deck: TDeck, state: TPresentationStored): TSlide => {
  const slide = deck.slides.find(item => item.slide_id === state.cursor.slide_id);
  if (!slide) throw new AppError(409, "The presentation slide changed");
  return slide;
};

const point_id = (deck: TDeck, state: Pick<TPresentationStored, "cursor">) => {
  const slide = deck.slides.find(item => item.slide_id === state.cursor.slide_id);
  return slide && presentation_sentences(slide)[state.cursor.sentence_index]?.sentence_id || `${state.cursor.slide_id}:0`;
};

const apply_point = (state: TPresentationStored, role: TContinuationRole, action: TContinuationAction) => {
  const current = state.continuation;
  state.continuation = apply_continuation(current, role, { event_id: crypto.randomUUID(), session_id: current.session_id,
    expected_revision: current.revision, generation: current.generation, action });
};

const rebuild_continuation = (state: TPresentationStored, deck: TDeck) => {
  state.continuation = create_continuation(state.continuation.session_id, deck.revision,
    [{ requirement: "spoken", point_id: point_id(deck, state) }]);
};

export const start_presentation = (session: string, deck: TDeck, stage_sequence: number): TPresentationStored => {
  if (!deck.slides.length) throw new AppError(409, "The deck needs a slide before presenting");
  const cursor = { slide_id: deck.slides[0].slide_id, sentence_index: 0 };
  return { revision: deck.revision, generation: 0, version: 0, status: "awaiting_paint", cursor, stage_sequence,
    painted: false, attempt: null, pin: null, proposal: null, last_reply: null, active_playback: false,
    wants_playback: true, pending_turn: null, pending_advance: null,
    continuation: create_continuation(session, deck.revision, [{ requirement: "spoken", point_id: point_id(deck, { cursor }) }]) };
};

export const stop_attempt = (state: TPresentationStored) => {
  if (state.attempt?.kind === "narration") apply_point(state, "host", { kind: "interrupt", attempt_id: state.attempt.attempt_id });
  state.attempt = null;
  state.active_playback = false;
};

export const pause_presentation = (state: TPresentationStored) => {
  stop_attempt(state);
  state.pin = null;
  state.pending_turn = null;
  state.wants_playback = false;
  state.status = state.proposal ? "awaiting_decision" : state.status === "completed" ? "completed" : "paused";
};

export const resting_presentation = (state: TPresentationStored, deck: TDeck): TPresentationStored["status"] => {
  if (state.proposal) return "awaiting_decision";
  const slide = deck.slides.at(-1);
  return !state.pending_advance && slide && state.cursor.slide_id === slide.slide_id &&
    state.cursor.sentence_index >= presentation_sentences(slide).length ? "completed" : "paused";
};

export const rebind_stage = (state: TPresentationStored, sequence: number) => {
  state.stage_sequence = sequence;
  state.painted = false;
  delete state.stage_painted_at;
  if (state.pending_advance) state.pending_advance.stage_sequence = sequence;
};

const move_slide = (state: TPresentationStored, deck: TDeck, index: number, publish: TPublishSlide) => {
  const slide = deck.slides[index];
  if (!slide) throw new AppError(409, "No slide in that direction");
  stop_attempt(state);
  state.pin = null;
  state.pending_turn = null;
  state.cursor = { slide_id: slide.slide_id, sentence_index: 0 };
  state.generation++;
  rebuild_continuation(state, deck);
  rebind_stage(state, publish(deck, slide.slide_id, state.stage_sequence));
  state.status = state.wants_playback ? "awaiting_paint" : "paused";
};

const onward = (state: TPresentationStored, deck: TDeck, publish: TPublishSlide) => {
  const index = deck.slides.findIndex(item => item.slide_id === state.cursor.slide_id);
  if (index < deck.slides.length - 1) move_slide(state, deck, index + 1, publish);
  else {
    state.wants_playback = false;
    state.cursor.sentence_index = presentation_sentences(cursor_slide(deck, state)).length;
    state.status = "completed";
  }
};

// The sentences after the one now playing, so their audio can be generated before the browser asks for it.
export const upcoming_narration = (state: TPresentationStored, deck: TDeck, count: number): string[] => {
  const pending = state.pending_advance;
  if (pending) return pending.sentences.slice(pending.next + 1, pending.next + 1 + count);
  const index = deck.slides.findIndex(slide => slide.slide_id === state.cursor.slide_id);
  if (index < 0) return [];
  const texts = presentation_sentences(deck.slides[index]).slice(state.cursor.sentence_index + 1).map(sentence => sentence.text);
  for (const slide of deck.slides.slice(index + 1)) {
    if (texts.length >= count) break;
    texts.push(...presentation_sentences(slide).map(sentence => sentence.text));
  }
  return texts.slice(0, count);
};

export const cue_presentation = (state: TPresentationStored, deck: TDeck, publish: TPublishSlide) => {
  if (state.attempt || state.pin || state.proposal || !state.wants_playback) return;
  if (!state.painted) { state.status = "awaiting_paint"; return; }
  const pending = state.pending_advance;
  if (pending) {
    if (pending.stage_sequence !== state.stage_sequence || pending.revision !== state.revision) throw new AppError(409, "The accepted slide is awaiting its paint");
    const text = pending.sentences[pending.next];
    if (text) {
      state.attempt = { attempt_id: crypto.randomUUID(), kind: "accepted_edit", text };
      state.status = "narrating";
      return;
    }
    state.pending_advance = null;
    onward(state, deck, publish);
    return;
  }
  const sentence = presentation_sentences(cursor_slide(deck, state))[state.cursor.sentence_index];
  if (!sentence) { onward(state, deck, publish); return; }
  const attempt_id = crypto.randomUUID();
  apply_point(state, "host", { kind: "play", point_id: sentence.sentence_id, attempt_id, asset_id: attempt_id });
  state.attempt = { attempt_id, kind: "narration", text: sentence.text };
  state.status = "narrating";
};

export const handle_presentation_paint = (state: TPresentationStored, deck: TDeck, paint: TPresentationPaint, publish: TPublishSlide) => {
  if (paint.sequence !== state.stage_sequence || paint.revision !== state.revision || paint.slide_id !== state.cursor.slide_id) {
    throw new AppError(409, "The audience painted an older frame");
  }
  state.painted = true;
  cue_presentation(state, deck, publish);
};

export const apply_presentation_action = (state: TPresentationStored, deck: TDeck, action: Exclude<TPresentationAction, { kind: "decide" }>, publish: TPublishSlide) => {
  switch (action.kind) {
    case "pause":
      pause_presentation(state);
      return;
    case "reconnect":
      pause_presentation(state);
      state.generation++;
      return;
    case "resume":
      if (state.proposal || state.status === "completed") throw new AppError(409, "Choose the pending review or restart the presentation");
      state.pin = null;
      state.pending_turn = null;
      state.wants_playback = true;
      cue_presentation(state, deck, publish);
      return;
    case "interrupt":
      if (action.attempt_id && state.attempt?.attempt_id !== action.attempt_id) throw new AppError(409, "This sentence already changed");
      if (!state.painted) throw new AppError(409, "Wait for the stage to paint before sending a question");
      stop_attempt(state);
      state.pin = { ...state.cursor, revision: state.revision, pin_id: crypto.randomUUID() };
      state.pending_turn = null;
      state.status = "listening";
      return;
    case "playing":
    case "failed":
    case "ended": {
      const attempt = state.attempt;
      if (!attempt || attempt.attempt_id !== action.attempt_id) throw new AppError(409, "This playback attempt already changed");
      if (action.kind === "playing") { state.active_playback = true; return; }
      if (action.kind === "failed") { pause_presentation(state); return; }
      if (!state.active_playback) throw new AppError(409, "This playback attempt has not started");
      state.attempt = null;
      state.active_playback = false;
      if (attempt.kind === "accepted_edit" && state.pending_advance) state.pending_advance.next++;
      if (attempt.kind === "narration") {
        apply_point(state, "player", { kind: "playout", attempt_id: action.attempt_id, asset_id: action.attempt_id, natural: true, certain: true });
        state.cursor.sentence_index++;
        rebuild_continuation(state, deck);
      }
      state.status = resting_presentation(state, deck);
      cue_presentation(state, deck, publish);
      return;
    }
    case "skip":
      if (state.pending_advance && state.painted) {
        stop_attempt(state);
        state.pending_advance.next++;
        state.wants_playback = true;
        cue_presentation(state, deck, publish);
        return;
      }
      // Normal Skip and Next both take the host to the next slide.
      break;
  }
  if (state.proposal || state.pending_advance) throw new AppError(409, "Finish the current slide review before navigating");
  const index = deck.slides.findIndex(item => item.slide_id === state.cursor.slide_id);
  const target = action.kind === "go_to" ? deck.slides.findIndex(item => item.slide_id === action.slide_id) :
    action.kind === "restart" ? 0 : action.kind === "back" ? index - 1 : index + 1;
  if (target === deck.slides.length) {
    pause_presentation(state);
    onward(state, deck, publish);
    return;
  }
  state.wants_playback = true;
  move_slide(state, deck, target, publish);
};

export const essential_sentences = (before: TSlide, after: TSlide) => {
  const existing = new Set(presentation_sentences(before).map(sentence => sentence.text.normalize("NFKC")));
  return presentation_sentences(after).filter(sentence => !existing.has(sentence.text.normalize("NFKC"))).map(sentence => sentence.text);
};
