import { download_pitch_plan } from "../controllers/pitch-plan";
import { live_turn_handler } from "../controllers/live-turn";
import { Router } from "express";
import { create_deck, decide_edit, propose_edit, read_deck, read_edit, reorder_deck } from "../controllers/deck";

export const decks = Router();
decks.post("/:session_id/decks", create_deck);
decks.get("/:session_id/decks/:deck_id", read_deck);
decks.post("/:session_id/decks/:deck_id/edits", propose_edit);
decks.get("/:session_id/decks/:deck_id/edits/:proposal_id", read_edit);
decks.post("/:session_id/decks/:deck_id/edits/:proposal_id/decision", decide_edit);

decks.post("/:session_id/decks/:deck_id/turns", live_turn_handler());

decks.post("/:session_id/decks/:deck_id/order", reorder_deck);

decks.get("/:session_id/decks/:deck_id/plan.json", download_pitch_plan);
