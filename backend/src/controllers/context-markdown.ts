import type { Response } from "express";
import { session_for } from "../middleware/host-session";
import { database } from "../repositories/store";
import { context_markdown } from "../services/context-markdown";
import { stream_context_markdown } from "../services/research-graphs";
import type { TApiRequest } from "../types/http";

export const download_context = (req: TApiRequest, res: Response) => {
  res.set("Cache-Control", "private, no-store");
  res.vary("Accept");
  const session = session_for(req);
  if (!session) return res.status(401).json({ error: "Unauthorized" });
  const bundle = database().research_by_id(session, req.params.research_id);
  if (!bundle) return res.status(404).json({ error: "Unknown research artifact" });
  const markdown = bundle.context_markdown ?? context_markdown(bundle);
  if (!markdown) return res.status(422).json({ error: "This research does not have a grounded context document." });
  const stream_requested = req.get("Accept")?.split(",").some(type => type.split(";")[0].trim().toLowerCase() === "text/event-stream");
  if (stream_requested && req.accepts(["text/markdown", "text/event-stream"]) === "text/event-stream") {
    return stream_context_markdown(res, markdown);
  }
  return res.set({ "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": 'attachment; filename="context.md"' }).send(markdown);
};
