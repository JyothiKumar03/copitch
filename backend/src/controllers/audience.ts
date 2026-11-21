import type { Response } from "express";
import type { TApiRequest } from "../types/http";
import { AppError } from "../errors/app-error";
import { z } from "zod";
import { database } from "../repositories/store";
import { session_for } from "../middleware/host-session";

const open_input = z.strictObject({ deck_id: z.string().min(1), revision: z.number().int().positive(), slide_id: z.string().min(1) });
const publish_input = open_input.extend({ expected_sequence: z.number().int().positive() });

const host = (req: TApiRequest, res: Response) => {
  res.set("Cache-Control", "no-store");
  const session = session_for(req);
  if (!session) throw new AppError(401, "Unauthorized");
  return session;
};

const approved = (session: string, deck_id: string, revision: number) => {
  const deck = database().decks.get(session, deck_id);
  if (!deck) throw new AppError(404, "Unknown deck");
  if (deck.revision !== revision) throw new AppError(409, "Deck revision changed");
  return deck;
};

export const open_audience = (req: TApiRequest, res: Response) => {
  const session = host(req, res);
  const input = open_input.safeParse(req.body);
  if (!input.success) return res.status(400).json({ error: "Invalid audience release" });
  const { deck_id, revision, slide_id } = input.data;
  return res.status(201).json(database().audience.open(session, approved(session, deck_id, revision), slide_id));
};

export const publish_audience = (req: TApiRequest, res: Response) => {
  const session = host(req, res);
  const input = publish_input.safeParse(req.body);
  if (!input.success) return res.status(400).json({ error: "Invalid audience release" });
  const { deck_id, revision, slide_id, expected_sequence } = input.data;
  return res.json(database().audience.publish(session, approved(session, deck_id, revision), slide_id, expected_sequence));
};

export const read_audience = (req: TApiRequest, res: Response) => {
  res.set("Cache-Control", "no-store");
  const token = req.get("Authorization")?.match(/^Bearer ([\w-]{43})$/)?.[1];
  const frame = token && database().audience.view(token);
  if (!frame) return res.status(401).json({ error: "Audience link is invalid or has expired. Ask the host to open a new view." });
  return res.json(frame);
};
