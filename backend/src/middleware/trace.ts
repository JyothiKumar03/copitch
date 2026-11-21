import type { RequestHandler, Response } from "express";
import type { TActivityKind } from "../types/research-job";

type TJobTrace = {
  operation: "research.attempt" | "research.activity";
  status: "started" | "completed" | "interrupted" | TActivityKind;
  job_id: string;
  attempt: number;
  duration_ms: number;
};

export const job_trace = (event: TJobTrace) => {
  if (process.env.TRACE_LOGS !== "1") return;
  console.log(JSON.stringify({ trace_id: event.job_id, ...event }));
};

export const bind_job_trace = (res: Response, job_id: string) => {
  res.locals.job_id = job_id;
  res.set("X-Trace-Id", job_id);
};

export const trace_request: RequestHandler = (req, res, next) => {
  const started = performance.now();
  const trace_id = crypto.randomUUID();
  res.set("X-Trace-Id", trace_id);
  res.once("close", () => {
    if (process.env.TRACE_LOGS !== "1") return;
    const route = typeof req.route?.path === "string" ? req.route.path : "unmatched";
    if (["/api/health", "/api/ready"].includes(route) && res.statusCode === 200) return;
    console.log(JSON.stringify({
      trace_id: res.locals.job_id ?? trace_id,
      job_id: res.locals.job_id,
      operation: "http.request",
      route,
      method: req.method,
      status: res.writableFinished ? res.statusCode : "disconnected",
      duration_ms: Math.round(performance.now() - started),
    }));
  });
  next();
};
