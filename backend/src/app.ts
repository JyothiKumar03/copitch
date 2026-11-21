import { database } from "./repositories/store";
import { trace_request } from "./middleware/trace";
import cors from "cors";
import express, { type Router } from "express";
import { api_error } from "./middleware/api-error";
import { audience } from "./routes/audience";
import { accounts } from "./routes/accounts";
import { current_account, trusted_origin } from "./middleware/account";
import { chat } from "./routes/chat";
import { continuation } from "./routes/continuation";
import { decks } from "./routes/deck";
import { interview } from "./routes/interview";
import { research } from "./routes/research";
import { sessions } from "./routes/session";

export const create_api = (raw_session_routes?: Router) => {
  const app = express();
  if (process.env.COPITCH_TRUST_GATEWAY === "1") app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use(trace_request);
  app.use(cors({ origin: process.env.CORS_ORIGIN ?? "http://localhost:3000", credentials: true }));
  app.use("/api", (req, res, next) => {
    res.set("Cache-Control", "private, no-store");
    if (req.method !== "GET" && !trusted_origin(req)) {
      return res.status(403).json({ error: "Untrusted request origin" });
    }
    if (process.env.NODE_ENV === "production" && req.method === "POST" &&
        /^\/(?:chat|sessions)(?:\/|$)/i.test(req.path)) {
      if (!current_account(req)) return res.status(401).json({ error: "Sign in to continue." });
      if (/^\/sessions\/?$/i.test(req.path)) return res.status(403).json({ error: "Create a private project to start a session." });
    }
    next();
  });
  app.get("/api/health", (_req, res) => res.json({ status: "ok", runtime: "bun" }));
  app.get("/api/ready", (_req, res) => {
    try {
      database().check_ready();
      res.json({ status: "ready" });
    } catch {
      res.status(503).json({ status: "unavailable" });
    }
  });
  if (raw_session_routes) app.use("/api/sessions", raw_session_routes);
  app.use(express.json({ limit: "512kb" }));
  return app;
};

const app = create_api(interview);
app.use("/api", accounts, chat, audience);
app.use("/api/sessions", sessions, research, decks, continuation);
app.use((_req, res) => res.status(404).json({ error: "Not found" }));
app.use(api_error);

export default app;
