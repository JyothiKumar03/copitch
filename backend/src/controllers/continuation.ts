import type { Response } from "express";
import type { TApiRequest } from "../types/http";
import { AppError } from "../errors/app-error";
import { z } from "zod";
import { database } from "../repositories/store";
import { session_for } from "../middleware/host-session";
import { ContinuationConflict, next_continuation } from "../services/continuation";
import { continuation_event } from "../types/continuation";
import type { TContinuationState } from "../types/continuation";

const id = z.string().min(1).max(192);
const start_input = z.strictObject({ deck_id: id, revision: z.number().int().positive() });
const command_input = continuation_event.omit({ session_id: true }).extend({ deck_id: id });

const host = (req: TApiRequest, res: Response) => {
  res.set("Cache-Control", "no-store");
  const session = session_for(req);
  if (!session) throw new AppError(401, "Unauthorized");
  return session;
};

const approved = (session: string, deck_id: string) => {
  const deck = database().decks.get(session, deck_id);
  if (!deck) throw new AppError(404, "Unknown deck");
  return deck;
};

const snapshot = (state: TContinuationState) => {
  return { revision: state.revision, generation: state.generation, points: state.points, next: next_continuation(state) };
};

export const start_continuation = (req: TApiRequest, res: Response) => {
  const session = host(req, res);
  const input = start_input.safeParse(req.body);
  if (!input.success) return res.status(400).json({ error: "Invalid deck or revision" });
  const deck = approved(session, input.data.deck_id);
  if (deck.revision !== input.data.revision) return res.status(409).json({ error: "Stale deck revision" });
  const state = database().continuations.start(session, deck.deck_id, deck.revision,
    deck.slides.map(slide => ({ point_id: slide.slide_id, requirement: "spoken" })));
  return res.json(snapshot(state));
};

export const get_continuation = (req: TApiRequest, res: Response) => {
  const session = host(req, res);
  const deck = approved(session, typeof req.query.deck_id === "string" ? req.query.deck_id : "");
  const state = database().continuations.get(session, deck.deck_id);
  if (!state) return res.status(404).json({ error: "Start continuation first" });
  if (deck.revision !== state.revision) return res.status(409).json({ error: "Start the approved revision" });
  return res.json(snapshot(state));
};

export const command_continuation = (req: TApiRequest, res: Response) => {
  const session = host(req, res);
  const input = command_input.safeParse(req.body);
  if (!input.success) return res.status(400).json({ error: "Invalid continuation command" });
  const { deck_id, ...command } = input.data;
  if (!["skip", "revisit", "reconnect"].includes(command.action.kind)) return res.status(403).json({ error: "Manual commands only" });
  const deck = approved(session, deck_id);
  if (deck.revision !== command.expected_revision) return res.status(409).json({ error: "Stale deck revision" });
  try {
    const state = database().continuations.apply(session, deck_id, "host", { ...command, session_id: session });
    return res.json(snapshot(state));
  } catch (error) {
    if (error instanceof ContinuationConflict) return res.status(409).json({ error: error.message });
    throw error;
  }
};

export const continuation_events = (req: TApiRequest, res: Response) => {
  const session = host(req, res);
  const deck = approved(session, typeof req.query.deck_id === "string" ? req.query.deck_id : "");
  const after = Number(req.query.after ?? 0);
  if (!Number.isSafeInteger(after) || after < 0) return res.status(400).json({ error: "Invalid event cursor" });
  return res.json({ events: database().continuations.events(session, deck.deck_id, after) });
};
