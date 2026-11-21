import type { Response } from "express";
import { session_for } from "../middleware/host-session";
import { database } from "../repositories/store";
import { estimate_pitch_seconds } from "../services/pitch";
import type { TApiRequest } from "../types/http";

export const download_pitch_plan = (req: TApiRequest, res: Response) => {
  res.set("Cache-Control", "private, no-store");
  const session = session_for(req);
  if (!session) return res.status(401).json({ error: "Unauthorized" });
  const revision = req.query.revision === undefined ? undefined : Number(req.query.revision);
  if (revision !== undefined && (!Number.isSafeInteger(revision) || revision < 1)) return res.status(400).json({ error: "Invalid revision" });
  const deck = database().decks.get(session, req.params.deck_id, revision);
  if (!deck) return res.status(404).json({ error: "Unknown deck revision" });
  const bundle = database().research_by_id(session, deck.research_id);
  const demo = deck.pitch?.demo;
  const agenda = deck.slides.flatMap(slide => {
    const point_id = "point-" + slide.slide_id;
    const narration = slide.narration.split(/\n\s*\n/u).filter(Boolean);
    const item = {
      kind: "slide" as const, point_id, slide_id: slide.slide_id, title: slide.title, highlights: slide.highlights,
      evidence_ids: slide.evidence_ids, estimated_seconds: estimate_pitch_seconds([slide]),
      beats: narration.map((text, index) => ({
        beat_id: slide.slide_id + "-beat-" + (index + 1), claim_id: slide.slide_id + "-claim-" + (index + 1), text,
      })),
    };
    const items: (typeof item | { kind: "walkthrough"; point_id: string; url: string; objective: string; estimated_seconds: number })[] = [item];
    if (demo?.after_slide_id === slide.slide_id) items.push({ kind: "walkthrough", point_id: point_id + "-demo",
      url: demo.url, objective: demo.objective, estimated_seconds: demo.seconds });
    return items;
  });
  res.attachment("plan.json").json({
    schema_version: 1, research_id: deck.research_id, deck_id: deck.deck_id, revision: deck.revision,
    title: deck.title, brief: bundle?.confirmed_brief?.summary, pitch: deck.pitch, agenda,
    estimated_seconds: estimate_pitch_seconds(deck.slides) + (demo?.seconds ?? 0),
    evidence: bundle?.evidence?.filter(item => agenda.some(point => point.kind === "slide" && point.evidence_ids.includes(item.id)))
      .map(({ id, location, url, derived_from }) => ({ id, location, url, derived_from })),
  });
};
