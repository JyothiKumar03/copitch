import { createHash } from "node:crypto";
import type { TSiteRun } from "../../../shared/site-run";
import { AppError } from "../errors/app-error";
import type { SessionStore } from "../repositories/session";
import type { TSourceSummary, TUploadedSource } from "../types/source";
import { source_selection_limit } from "../types/studio-turn";
import { studio_context } from "./studio-state";
import { update_studio_scope } from "./studio-turn";

export const save_site_source = (db: SessionStore, session: string, { run_id: id }: Pick<TSiteRun, "run_id">): TSourceSummary =>
  db.site_runs.attach_source(session, id, run => {
    const { state } = studio_context(db, session);
    const selected = state.source_ids.includes(id);
    if (!selected && state.phase === "researching") throw new AppError(409, "Wait for research to finish before adding the walkthrough.");
    if (!selected && state.source_ids.length >= source_selection_limit) {
      throw new AppError(409, `Remove a source first. A project can use up to ${source_selection_limit}.`);
    }
    const filename = `${new URL(run.url).hostname} agent walkthrough`;
    const records = run.steps.map(step => ({ number: step.n, text: `Step ${step.n}. ${step.caption}. ${step.title}. ${step.facts.join(" ")}`,
      url: step.url, image: `/api/sessions/${session}/site-runs/${id}/steps/${step.n}/screenshot` }));
    const source: TUploadedSource = { source_id: id, filename, kind: "web_flow", locations: records.length, records,
      gaps: run.coverage.walls.slice(0, 20).map(wall => `${wall.label}: ${wall.reason}`) };
    const summary = db.sources.save(session, createHash("sha256").update("site-run:" + id).digest("hex"), source);
    if (!selected) update_studio_scope(db, session, { source_ids: [...state.source_ids, summary.source_id], urls: state.urls ?? [], materials: state.materials ?? "",
      source_policy: state.source_policy ?? "public_search",
      expected_proposal_id: state.phase === "proposed" ? state.proposal?.proposal_id ?? null : null });
    return summary;
  });
