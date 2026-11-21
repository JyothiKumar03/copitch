import { download_pitch_plan } from "../controllers/pitch-plan";
import { live_turn_handler } from "../controllers/live-turn";
import { Router } from "express";
import { create_deck, decide_edit, list_decks, propose_edit, read_deck, read_edit, reorder_deck } from "../controllers/deck";
import { command_presentation, open_presentation_stage, presentation_audio, presentation_turn_handler, read_presentation,
  start_live_presentation } from "../controllers/presentation-live";

export const create_deck_router = (turn_handler = presentation_turn_handler(), audio_handler = presentation_audio()) => {
  const decks = Router();
  decks.post("/:session_id/decks", create_deck);
  decks.get("/:session_id/decks", list_decks);
  decks.get("/:session_id/decks/:deck_id", read_deck);
  decks.get("/:session_id/decks/:deck_id/live", read_presentation);
  decks.post("/:session_id/decks/:deck_id/live/start", start_live_presentation);
  decks.post("/:session_id/decks/:deck_id/live/stage", open_presentation_stage);
  decks.post("/:session_id/decks/:deck_id/live/commands", command_presentation);
  decks.post("/:session_id/decks/:deck_id/live/turns", turn_handler);
  decks.get("/:session_id/decks/:deck_id/live/audio/:attempt_id", audio_handler);
  decks.post("/:session_id/decks/:deck_id/edits", propose_edit);
  decks.get("/:session_id/decks/:deck_id/edits/:proposal_id", read_edit);
  decks.post("/:session_id/decks/:deck_id/edits/:proposal_id/decision", decide_edit);

  decks.post("/:session_id/decks/:deck_id/turns", live_turn_handler());

  decks.post("/:session_id/decks/:deck_id/order", reorder_deck);

  decks.get("/:session_id/decks/:deck_id/plan.json", download_pitch_plan);
  return decks;
};

export const decks = create_deck_router();
