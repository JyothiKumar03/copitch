import { Router } from "express";
import { continuation_events, command_continuation, get_continuation, start_continuation } from "../controllers/continuation";

export const continuation = Router();
continuation.get("/:session_id/continuation", get_continuation);
continuation.post("/:session_id/continuation/start", start_continuation);
continuation.post("/:session_id/continuation/commands", command_continuation);
continuation.get("/:session_id/continuation/events", continuation_events);
