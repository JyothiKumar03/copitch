import type { Response } from "express";
import { session_for } from "../middleware/host-session";
import { database } from "../repositories/store";
import { pitch_content } from "../services/pitch-content";
import type { TApiRequest } from "../types/http";

export const read_pitch_content = (req: TApiRequest, res: Response) => {
  res.set("Cache-Control", "private, no-store");
  const session = session_for(req);
  if (!session) return res.status(401).json({ error: "Unauthorized" });
  const bundle = database().research_by_id(session, req.params.research_id);
  if (!bundle) return res.status(404).json({ error: "Unknown research artifact" });
  return res.json(pitch_content(bundle));
};
