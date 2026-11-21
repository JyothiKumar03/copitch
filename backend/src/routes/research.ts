import { Hono } from "hono";
import { research_handlers } from "../controllers/research";

export const research = new Hono();
const handlers = research_handlers();
research.post("/:session_id/research/brief", handlers.review);
research.post("/:session_id/research", handlers.build);
research.get("/:session_id/research/:research_id/presentation.md", handlers.download);
