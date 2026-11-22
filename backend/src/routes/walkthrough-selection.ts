import { Router } from "express";
import type { Request } from "express";
import { z } from "zod";
import { current_account } from "../middleware/account";
import { AppError } from "../errors/app-error";
import { database } from "../repositories/store";
import type { TWalkthroughExportScope } from "../repositories/walkthrough-export";
import { publish_walkthrough_selection, selection_input, walkthrough_selection_catalog } from "../services/walkthrough-selection";

export const walkthrough_selection_routes = (kind: TWalkthroughExportScope["kind"]) => {
  const router = Router({ mergeParams: true });
  const scope_for = (req: Request): TWalkthroughExportScope => {
    const account = current_account(req);
    if (!account) throw new AppError(401, "Sign in to open the PowerPoint selection.");
    const session = z.uuid().safeParse(req.params.session_id);
    const capture = z.uuid().safeParse(req.params.selection_capture_id);
    if (!session.success || !capture.success || !database().accounts.owns(account.id, session.data)) throw new AppError(404, "Walkthrough unavailable.");
    return { session: session.data, kind, capture: capture.data };
  };
  router.get("/", (req, res) => {
    res.json(walkthrough_selection_catalog(database(), scope_for(req)));
  });
  router.post("/", async (req, res) => {
    const scope = scope_for(req);
    const input = selection_input.safeParse(req.body);
    if (!input.success) throw new AppError(400, "Review and confirm unique saved items or your own text before creating the PowerPoint.");
    const saved = await publish_walkthrough_selection(database(), scope, input.data);
    res.status(201).json(saved);
  });
  router.get("/:export_id/download", (req, res) => {
    const scope = scope_for(req);
    const id = z.uuid().safeParse(req.params.export_id);
    const bytes = id.success && database().walkthrough_exports.download(scope, id.data);
    if (!bytes) throw new AppError(404, "PowerPoint unavailable.");
    res.set({ "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "Content-Disposition": 'attachment; filename="selected-content.pptx"' }).send(Buffer.from(bytes));
  });
  return router;
};
