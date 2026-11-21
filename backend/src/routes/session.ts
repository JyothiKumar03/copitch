import { Router } from "express";
import { cancel_run, create_session, run_events, start_run } from "../controllers/session";

export const sessions = Router();
sessions.post("/", create_session);
sessions.post("/:session_id/runs", start_run);
sessions.get("/:session_id/runs/:run_id/events", run_events);
sessions.delete("/:session_id/runs/:run_id", cancel_run);
