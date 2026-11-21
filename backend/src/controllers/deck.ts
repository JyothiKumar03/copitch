import type { Response } from "express";
import type { TApiRequest } from "../types/http";
import { AppError } from "../errors/app-error";
import { z } from "zod";
import { database } from "../repositories/store";
import { session_for } from "../middleware/host-session";
import { pitch_variant_key } from "../repositories/deck";
import { prepare_pitch } from "../services/pitch";
import type { TDeck } from "../types/deck";
import { public_url } from "../services/research";
import { compile_deck, edit_input } from "../services/deck";

const prepare_input = z.strictObject({
  research_id: z.string().uuid(),
  pitch: z.strictObject({
    audience: z.string().trim().max(6000).transform(value => value.normalize("NFKC").replace(/\s+/gu, " ")),
    duration_minutes: z.number().int().min(1).max(60),
    slide_count: z.number().int().min(1).max(100).optional(),
    demo: z.strictObject({ url: z.string().max(2048).refine(value => !!public_url(value)),
      objective: z.string().trim().min(1).max(240), seconds: z.number().int().min(1).max(3600),
    }).optional(),
  }).optional(),
});
const preparing = new Map<string, Promise<TDeck>>();

export const list_decks = (req: TApiRequest, res: Response) => {
  const session = session_for(req);
  if (!session) return res.status(401).json({ error: "Unauthorized" });
  const research = z.string().uuid().safeParse(req.query.research_id);
  if (!research.success) throw new AppError(400, "Supply a research artifact ID");
  return res.json({ decks: database().decks.variants(session, research.data) });
};

const preview_editable = (session: string, deck_id: string) => {
  const live = database().presentations.get(session, deck_id);
  if (live && (live.proposal || live.pending_advance || !["paused", "completed"].includes(live.status))) {
    throw new AppError(409, "Finish the live review and pause before changing this deck outside the presentation");
  }
};

export const create_deck = async (req: TApiRequest, res: Response) => {
  const session = session_for(req);
  if (!session) return res.status(401).json({ error: "Unauthorized" });
  const body = prepare_input.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "Supply a research ID and valid pitch settings" });
  const { research_id, pitch } = body.data;
  const variant = pitch_variant_key(pitch);
  const db = database();
  const existing = db.decks.for_research(session, research_id, variant);
  if (existing) return res.json(existing);
  const bundle = db.research_by_id(session, research_id);
  if (!bundle) return res.status(404).json({ error: "Unknown research artifact" });
  if (!pitch) return res.status(201).json(db.decks.create(session, compile_deck(bundle)));
  const key = JSON.stringify([session, research_id, variant]);
  const running = preparing.get(key);
  if (running) return res.json(await running);
  const result = prepare_pitch(bundle, pitch)
    .then(snapshot => db.decks.create(session, snapshot, variant))
    .finally(() => preparing.delete(key));
  preparing.set(key, result);
  return res.status(201).json(await result);
};

export const read_deck = (req: TApiRequest, res: Response) => {
  const session = session_for(req);
  if (!session) return res.status(401).json({ error: "Unauthorized" });
  const raw = req.query.revision;
  const revision = raw === undefined ? undefined : Number(raw);
  if (revision !== undefined && (!Number.isSafeInteger(revision) || revision < 1)) return res.status(400).json({ error: "Invalid revision" });
  const deck = database().decks.get(session,req.params.deck_id,revision);
  return deck ? res.json(deck) : res.status(404).json({ error: "Unknown deck revision" });
};

export const propose_edit = (req: TApiRequest, res: Response) => {
  const session = session_for(req);
  if (!session) return res.status(401).json({ error: "Unauthorized" });
  const parsed = edit_input.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid edit", details: parsed.error.issues.map(issue => issue.path.join(".")) });
  return res.json(database().decks.propose(session,req.params.deck_id,parsed.data));
};

export const read_edit = (req: TApiRequest, res: Response) => {
  const session = session_for(req);
  if (!session) return res.status(401).json({ error: "Unauthorized" });
  const proposal = database().decks.proposal(session,req.params.deck_id,req.params.proposal_id);
  return proposal ? res.json(proposal) : res.status(404).json({ error: "Unknown proposal" });
};

export const decide_edit = (req: TApiRequest, res: Response) => {
  const session = session_for(req);
  if (!session) return res.status(401).json({ error: "Unauthorized" });
  const parsed = z.strictObject({ decision: z.enum(["approve","reject"]) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Choose approve or reject" });
  preview_editable(session, req.params.deck_id);
  return res.json(database().decks.decide(session,req.params.deck_id,req.params.proposal_id,parsed.data.decision));
};

export const reorder_deck = (req: TApiRequest, res: Response) => {
  const session = session_for(req);
  if (!session) return res.status(401).json({ error: "Unauthorized" });
  const input = z.strictObject({ base_revision: z.number().int().positive(),
    slide_ids: z.array(z.string().min(1).max(128)).min(1).max(100) }).safeParse(req.body);
  if (!input.success) return res.status(400).json({ error: "Supply the complete slide order and base revision" });
  preview_editable(session, req.params.deck_id);
  return res.json(database().decks.reorder(session, req.params.deck_id, input.data.base_revision, input.data.slide_ids));
};
