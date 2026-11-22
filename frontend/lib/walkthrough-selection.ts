import type {
  TWalkthroughSelectionCatalog, TWalkthroughSelectionExport, TWalkthroughSelectionInput, TWalkthroughSelectionItem, TWalkthroughSelectionSlide,
} from "../../shared/walkthrough-selection";
import { request } from "./research";

export type TWalkthroughSelectionSource = {
  kind: "site-runs" | "website-walkthroughs";
  captureId: string;
};

const pathFor = (projectId: string, source: TWalkthroughSelectionSource) =>
  `/api/sessions/${encodeURIComponent(projectId)}/${source.kind}/${encodeURIComponent(source.captureId)}/powerpoint-selections`;

const itemKinds = new Set(["title", "caption", "fact", "url", "screenshot"]);
const isItem = (value: unknown): value is TWalkthroughSelectionItem => {
  const item = value as Partial<TWalkthroughSelectionItem> | null;
  return !!item && typeof item.item_id === "string" && typeof item.text === "string" &&
    typeof item.kind === "string" && itemKinds.has(item.kind) && typeof item.page_number === "number" &&
    Number.isSafeInteger(item.page_number) && item.page_number > 0;
};

const isSlide = (value: unknown): value is TWalkthroughSelectionSlide => {
  const slide = value as Partial<TWalkthroughSelectionSlide> | null;
  if (!slide || !Array.isArray(slide.items)) return false;
  if (slide.kind === "host") return typeof slide.host_text === "string" && slide.items.length === 0;
  return slide.kind === "source" && typeof slide.page_number === "number" &&
    Number.isSafeInteger(slide.page_number) && slide.page_number > 0 && !!slide.items.length &&
    slide.items.every(item => isItem(item) && item.page_number === slide.page_number);
};

const isSavedExport = (value: unknown): value is TWalkthroughSelectionExport => {
  const entry = value as Partial<TWalkthroughSelectionExport> | null;
  return !!entry && typeof entry.export_id === "string" && typeof entry.source_revision === "string" &&
    typeof entry.revision === "number" && Number.isSafeInteger(entry.revision) && entry.revision > 0 &&
    typeof entry.created_at === "number" && Number.isFinite(entry.created_at) &&
    Array.isArray(entry.items) && entry.items.every(isItem) &&
    Array.isArray(entry.item_ids) && entry.item_ids.length === entry.items.length &&
    entry.item_ids.every((id, index) => id === entry.items?.[index].item_id) &&
    Array.isArray(entry.host_additions) && entry.host_additions.every(addition => typeof addition === "string") &&
    (entry.slides === undefined || (Array.isArray(entry.slides) && entry.slides.every(isSlide)));
};

export const readWalkthroughSelections = async (projectId: string, source: TWalkthroughSelectionSource, signal: AbortSignal) => {
  const catalog = await (await request(pathFor(projectId, source), { session_id: projectId }, undefined, { signal })).json() as
    Partial<TWalkthroughSelectionCatalog> | null;
  if (!catalog || typeof catalog.source_revision !== "string" || typeof catalog.has_archived_export !== "boolean" ||
      !Array.isArray(catalog.items) || !catalog.items.every(isItem) ||
      !Array.isArray(catalog.exports) || !catalog.exports.every(isSavedExport)) {
    throw new Error("Couldn’t read the saved PowerPoint content. Try again.");
  }
  return catalog as TWalkthroughSelectionCatalog;
};

export const saveWalkthroughSelection = async (
  projectId: string, source: TWalkthroughSelectionSource, input: TWalkthroughSelectionInput,
) => {
  const saved: unknown = await (await request(pathFor(projectId, source), { session_id: projectId }, input)).json();
  if (!isSavedExport(saved) || saved.source_revision !== input.source_revision ||
      saved.item_ids.length !== input.item_ids.length || saved.item_ids.some((id, index) => id !== input.item_ids[index]) ||
      saved.host_additions.length !== input.host_additions.length ||
      saved.host_additions.some((addition, index) => addition !== input.host_additions[index])) {
    throw new Error("Couldn’t verify the saved PowerPoint selection. Try again.");
  }
  return saved;
};

export const downloadWalkthroughSelection = async (projectId: string, source: TWalkthroughSelectionSource, saved: TWalkthroughSelectionExport) => {
  const response = await request(`${pathFor(projectId, source)}/${encodeURIComponent(saved.export_id)}/download`, { session_id: projectId });
  const blob = await response.blob();
  if (blob.type !== "application/vnd.openxmlformats-officedocument.presentationml.presentation" || !blob.size) {
    throw new Error("Couldn’t read the PowerPoint file. Try downloading it again.");
  }
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = `walkthrough-selection-${saved.revision}.pptx`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
};
