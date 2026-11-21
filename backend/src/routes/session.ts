import { research } from "./research";
import { Hono } from "hono";
import { cancel_run, create_session, run_events, start_run } from "../controllers/session";

export const sessions = new Hono();
sessions.post("/api/sessions", create_session);
sessions.post("/api/sessions/:session_id/runs", start_run);
sessions.get("/api/sessions/:session_id/runs/:run_id/events", run_events);
sessions.delete("/api/sessions/:session_id/runs/:run_id", cancel_run);

sessions.route("/api/sessions", research);
