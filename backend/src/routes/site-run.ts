import { walkthrough_selection_routes } from "./walkthrough-selection";
import { Router } from "express";
import type { Request } from "express";
import { z } from "zod";
import { AppError } from "../errors/app-error";
import { current_account } from "../middleware/account";
import { database } from "../repositories/store";
import { configured_site_decider } from "../services/site-agent";
import { save_site_source } from "../services/site-source";
import { site_navigation } from "../services/site-policy";
import { website_capture_url } from "../services/website-capture";
import { site_run_input } from "../types/site-run";
import { SiteRunWorker } from "../workers/site-run";

const project_for = (request: Request) => {
  const account = current_account(request);
  if (!account) throw new AppError(401, "Sign in to open this walkthrough.");
  const session = request.params.session_id;
  if (typeof session !== "string" || !database().accounts.owns(account.id, session)) throw new AppError(404, "Project unavailable.");
  return session;
};

const run_for = (request: Request) => {
  const result = z.uuid().safeParse(request.params.run_id);
  if (!result.success) throw new AppError(404, "Walkthrough unavailable.");
  return result.data;
};
const configured_budget = () => {
  const default_budget_usd = 5;
  const value = Number(process.env.SITE_RUN_BUDGET_USD ?? default_budget_usd);
  return Number.isFinite(value) ? Math.max(default_budget_usd, value) : default_budget_usd;
};

const base = "/:session_id/site-runs";
export const site_run_worker = new SiteRunWorker(database);
export const create_site_routes = (worker: Pick<SiteRunWorker, "wake" | "stop">) => {
  const router = Router();
  router.use(base + "/:selection_capture_id/powerpoint-selections", walkthrough_selection_routes("site-runs"));

  router.get(base, (req, res) => { res.json({ runs: database().site_runs.list(project_for(req)) }); });
  router.post(base, (req, res) => {
    const session = project_for(req);
    const input = site_run_input.safeParse(req.body);
    if (!input.success) throw new AppError(400, "Review and approve a public starting page, audience and goal.");
    const root = website_capture_url(input.data.url);
    if (!root || !("url" in site_navigation(root, root.href))) {
      throw new AppError(400, "Enter a public HTTP or HTTPS page without credentials, query parameters or a custom port.");
    }
    const run = database().site_runs.enqueue(session, { ...input.data, url: root.href }, configured_budget(),
      configured_site_decider() ? "model" : "browser");
    res.status(run.status === "queued" || run.status === "running" ? 202 : 200).json(run);
    worker.wake();
  });

  router.get(base + "/:run_id", (req, res) => {
    const run = database().site_runs.get(project_for(req), run_for(req));
    if (!run) throw new AppError(404, "Walkthrough unavailable.");
    res.json(run);
  });

  router.post(base + "/:run_id/stop", (req, res) => {
    const id = run_for(req);
    const run = database().site_runs.stop(project_for(req), id);
    if (!run) throw new AppError(404, "Walkthrough unavailable.");
    if (run.status === "stopped") worker.stop(id);
    res.json(run);
  });

  router.get(base + "/:run_id/steps/:step/screenshot", (req, res) => {
    const session = project_for(req);
    const step = z.coerce.number().int().positive().safeParse(req.params.step);
    const bytes = step.success && database().site_runs.screenshot(session, run_for(req), step.data);
    if (!bytes) throw new AppError(404, "Screenshot unavailable.");
    res.type("jpeg").send(Buffer.from(bytes));
  });

  router.get(base + "/:run_id/powerpoint", (req, res) => {
    const bytes = database().site_runs.download(project_for(req), run_for(req));
    if (!bytes) throw new AppError(404, "PowerPoint unavailable.");
    res.set({ "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "Content-Disposition": 'attachment; filename="agent-walkthrough.pptx"' }).send(Buffer.from(bytes));
  });

  router.post(base + "/:run_id/source", (req, res) => {
    const session = project_for(req);
    const id = run_for(req);
    const db = database();
    const saved = save_site_source(db, session, { run_id: id });
    res.status(201).json(saved);
  });
  return router;
};

export const site_runs = create_site_routes(site_run_worker);
