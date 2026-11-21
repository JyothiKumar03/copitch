import { download_pitch } from "../controllers/pitch-markdown";
import { read_pitch_content } from "../controllers/pitch-content";
import express, { Router } from "express";
import { source_host, upload_source } from "../controllers/source";
import { max_source_bytes } from "../services/source";
import { research_handlers } from "../controllers/research";

export const research = Router();
const handlers = research_handlers();
research.post("/:session_id/research/sources", source_host,
  express.raw({ type:"multipart/form-data",limit:max_source_bytes + 65536,inflate:false }),upload_source);
research.post("/:session_id/research/brief", handlers.review);
research.post("/:session_id/research", handlers.build);
research.get("/:session_id/research/:research_id/presentation.md", handlers.download);

research.get("/:session_id/research/jobs/:job_id", handlers.job);

research.get("/:session_id/research/:research_id/pitch", read_pitch_content);

research.get("/:session_id/research/:research_id/pitch.md",download_pitch);
