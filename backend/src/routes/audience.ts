import { Router } from "express";
import { open_audience, publish_audience, read_audience } from "../controllers/audience";
import { paint_presentation } from "../controllers/presentation-live";

export const audience = Router();
audience.post("/sessions/:session_id/audience/open", open_audience);
audience.post("/sessions/:session_id/audience/publish", publish_audience);
audience.get("/audience", read_audience);
audience.post("/audience/paint", paint_presentation);
