import { Router } from "express";
import { open_audience, publish_audience, read_audience } from "../controllers/audience";

export const audience = Router();
audience.post("/sessions/:session_id/audience/open", open_audience);
audience.post("/sessions/:session_id/audience/publish", publish_audience);
audience.get("/audience", read_audience);
