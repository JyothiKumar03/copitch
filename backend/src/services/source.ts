import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { Worker } from "node:worker_threads";
import { AppError } from "../errors/app-error";
import type { TSourceContent, TUploadedSource } from "../types/source";
import type { TEvidence } from "../types/research";
import { read_csv } from "./source-csv";
import { read_pptx } from "./source-pptx";
import { read_ppt } from "./source-ppt";
import { source_formats, source_limits } from "../constants/sources";
import type { TSourceLimits } from "../constants/sources";
import type { TSourceKind } from "../types/source";

export const max_source_bytes = source_limits.bytes;

type TUploadKind = Exclude<TSourceKind, "web" | "web_flow">;

export const source_kind = (filename: string): TUploadKind => {
  const extension = filename.split(".").at(-1)?.toLowerCase();
  if (extension && extension !== "web" && extension !== "web_flow" && Object.hasOwn(source_formats, extension)) return extension as TUploadKind;
  throw new AppError(415, "Choose a text PDF, PowerPoint (.ppt or .pptx), or UTF-8 CSV.");
};

const read_pdf = async (bytes: Buffer, limits: TSourceLimits = source_limits): Promise<TSourceContent> => {
  if (!bytes.subarray(0,1024).includes("%PDF-")) throw new AppError(422,"This file is not a PDF");
  const src = new URL("../workers/pdf-source.ts", import.meta.url);
  const path = existsSync(src) ? src : new URL("../src/workers/pdf-source.ts", import.meta.url);
  const worker = new Worker(path,{ workerData:{ bytes, pages: limits.pages, characters: limits.characters } });
  try {
    return await new Promise<TSourceContent>((resolve,reject) => {
      const timer = setTimeout(() => reject(new AppError(422,"PDF text extraction timed out")),limits.timeout_ms);
      worker.once("message", (reply: {content?:TSourceContent;error?:string}) => {
        clearTimeout(timer);
        if (reply.content) resolve(reply.content); else reject(new AppError(422,reply.error ?? "Unreadable PDF"));
      });
      worker.once("error", error => { clearTimeout(timer); reject(error); });
      worker.once("exit", () => { clearTimeout(timer); reject(new AppError(422,"PDF reader stopped")); });
    });
  } finally { await worker.terminate(); }
};

const parsers = { pdf: read_pdf, ppt: read_ppt, pptx: read_pptx, csv: read_csv };
const mib = (bytes: number) => Math.round(bytes / 1024 / 1024);

export const parse_source = async (filename: string, bytes: Buffer, limits: TSourceLimits = source_limits): Promise<TUploadedSource> => {
  const kind = source_kind(filename);
  if (!bytes.length) throw new AppError(422,"The file is empty");
  if (bytes.length > limits.bytes) throw new AppError(413,`File exceeds ${mib(limits.bytes)} MiB`);
  try {
    const content = kind === "pdf" ? await read_pdf(bytes, limits) : await parsers[kind](bytes);
    if (!content.records.length) throw new AppError(422,"No extractable text or rows. Paste text or upload a text-based file.");
    return { source_id:crypto.randomUUID(), filename, kind, locations:content.records.length, ...content };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(422,"Could not read the uploaded document. Check the file format.");
  }
};

export const source_evidence_prefix = (source_id: string, kind: TSourceKind) => {
  const prefix = parseInt(createHash("sha256").update(source_id).digest("hex").slice(0,12),16);
  return (kind === "web_flow" ? "B" : "F") + prefix;
};

export const source_evidence = (source: TUploadedSource): TEvidence[] => {
  const prefix = source_evidence_prefix(source.source_id, source.kind);
  const unit = source_formats[source.kind].location;
  // Older records did not retain a reported total as a measurement or identify cohort/group rows.
  // Keep their quoted cells usable, but withhold derived conversion metrics until the input is parsed again.
  const ambiguous_legacy_counts = source.kind === "csv" && !source.conversion_scope_version && source.records.some(row =>
    /(?:^|; )(?:(?:cohort|group): |(?:segment|customer segment): (?:overall|all|total|grand total)(?:;|$))/iu.test(row.text));
  return source.records.map(row => ({
    id: prefix + String(row.number).padStart(5,"0"), source_id: source.source_id, origin:"material",
    location: `${source.filename}, ${unit} ${row.number}`, passage:row.text, ...(row.numeric_series && {numeric_series:row.numeric_series}),
    ...(row.url && { url: row.url }), ...(row.image && { image: row.image }),
    ...(row.metric && !ambiguous_legacy_counts && { metric:row.metric }),
  }));
};
