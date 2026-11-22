import { walkthrough_selection_routes } from "./walkthrough-selection";
import { Router } from "express";
import type { Request } from "express";
import { z } from "zod";
import { DEFAULT_WEBSITE_WALKTHROUGH_DEPTH, WEBSITE_WALKTHROUGH_DEPTHS } from "../../../shared/website-walkthrough";
import { AppError } from "../errors/app-error";
import { current_account } from "../middleware/account";
import { database } from "../repositories/store";
import { createHash } from "node:crypto";
import { source_selection_limit } from "../types/studio-turn";
import type { TUploadedSource } from "../types/source";
import { source_summary } from "../repositories/source";
import { studio_context } from "../services/studio-state";
import { update_studio_scope } from "../services/studio-turn";
import { website_capture_url } from "../services/website-capture";
import { WebsiteWalkthroughWorker } from "../workers/website-walkthrough";

const approved_input = z.strictObject({
  request_id: z.string().uuid(),
  url: z.string().trim().min(1).max(2048),
  audience: z.string().trim().min(1).max(180),
  goal: z.string().trim().min(1).max(600),
  max_depth: z.literal(WEBSITE_WALKTHROUGH_DEPTHS).default(DEFAULT_WEBSITE_WALKTHROUGH_DEPTH),
  approved: z.literal(true),
});

const project_for = (request: Request) => {
  const account = current_account(request);
  if (!account) throw new AppError(401, "Sign in to open this walkthrough.");
  const session = request.params.session_id;
  if (typeof session !== "string" || !database().accounts.owns(account.id, session)) {
    throw new AppError(404, "Project unavailable.");
  }
  return session;
};

const approved_url = (value: string) => {
  const url = website_capture_url(value);
  if (!url || [...url.searchParams.keys()].some(name => /(?:^|[_-])(?:key|token|sig|signature|password|secret|auth|session)(?:$|[_-])/iu.test(name))) return;
  url.hash = "";
  return url.href;
};

const walkthrough_for = (request: Request) => {
  const id = z.string().uuid().safeParse(request.params.walkthrough_id);
  if (!id.success) throw new AppError(404, "Walkthrough unavailable.");
  return id.data;
};

export const website_walkthrough_worker = new WebsiteWalkthroughWorker(database);
const powerpoint_type = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const base = "/:session_id/website-walkthroughs";
export const website_walkthroughs = Router();
website_walkthroughs.use(base + "/:selection_capture_id/powerpoint-selections", walkthrough_selection_routes("website-walkthroughs"));

website_walkthroughs.get(base, (req, res) => {
  res.json({ walkthroughs: database().website_walkthroughs.list(project_for(req)) });
});

website_walkthroughs.post(base, (req, res) => {
  const session = project_for(req);
  const input = approved_input.safeParse(req.body);
  if (!input.success) throw new AppError(400, "Review and approve a starting URL, audience and presentation goal.");
  const url = approved_url(input.data.url);
  if (!url) throw new AppError(400, "Use a public website URL without access tokens or a custom port.");
  const job = database().website_walkthroughs.enqueue(session, { ...input.data, url });
  res.status(job.status === "completed" || job.status === "failed" ? 200 : 202).json(job);
  website_walkthrough_worker.wake();
});

website_walkthroughs.get(base + "/:walkthrough_id", (req, res) => {
  const job = database().website_walkthroughs.get(project_for(req), walkthrough_for(req));
  if (!job) throw new AppError(404, "Walkthrough unavailable.");
  res.json(job);
});

website_walkthroughs.get(base + "/:walkthrough_id/powerpoint", (req, res) => {
  const content = database().website_walkthroughs.download(project_for(req), walkthrough_for(req));
  if (!content) throw new AppError(404, "PowerPoint unavailable.");
  res.set({ "Content-Type": powerpoint_type, "Content-Disposition": 'attachment; filename="product-walkthrough.pptx"' });
  res.send(Buffer.from(content));
});

website_walkthroughs.get(base + "/:walkthrough_id/screenshots/:capture_id", (req, res) => {
  const session = project_for(req);
  const capture = z.coerce.number().int().positive().safeParse(req.params.capture_id);
  const screenshot = capture.success && database().website_walkthroughs.screenshot(session, walkthrough_for(req), capture.data);
  if (!screenshot) throw new AppError(404, "Screenshot unavailable.");
  res.type("jpeg").send(Buffer.from(screenshot));
});

// The host chose to build a presenter deck from a finished walkthrough. Save its captured page facts as one
// project source, each fact tied to its page URL and screenshot, and add that source to the studio scope.
website_walkthroughs.post(base + "/:walkthrough_id/source", (req, res) => {
  const session = project_for(req);
  const id = walkthrough_for(req);
  const db = database();
  const job = db.website_walkthroughs.get(session, id);
  if (!job || job.status !== "completed" || !job.pages.length) throw new AppError(409, "Finish the walkthrough before using it in a deck.");
  const host = new URL(job.url).hostname;
  const records = job.pages.flatMap(page => page.facts.map(fact => ({ page, fact }))).map(({ page, fact }, index) => ({
    number: index + 1, text: `${page.title}: ${fact}`, url: page.url,
    image: `/api/sessions/${session}/website-walkthroughs/${id}/screenshots/${page.capture_id}`,
  }));
  if (!records.length) throw new AppError(422, "The captured pages have no readable text to use in a deck.");
  const source: TUploadedSource = { source_id: crypto.randomUUID(), filename: `${host} walkthrough`, kind: "web",
    locations: records.length, records, gaps: job.attempts.filter(attempt => attempt.status === "failed")
      .map(attempt => `${attempt.url} could not be captured${attempt.reason ? ": " + attempt.reason : "."}`) };
  const saved = db.sources.save(session, createHash("sha256").update("walkthrough:" + id).digest("hex"), source);
  const { state } = studio_context(db, session);
  const source_ids = [...new Set([...state.source_ids, saved.source_id])];
  if (source_ids.length > source_selection_limit) throw new AppError(409, `Remove a source first. A project can use up to ${source_selection_limit}.`);
  update_studio_scope(db, session, { source_ids, urls: state.urls ?? [], materials: state.materials ?? "",
    source_policy: state.source_policy ?? "public_search",
    expected_proposal_id: state.phase === "proposed" ? state.proposal?.proposal_id ?? null : null });
  res.status(201).json(source_summary(db.sources.selected(session, [saved.source_id])[0]));
});
