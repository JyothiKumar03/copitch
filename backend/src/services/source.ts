import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { Worker } from "node:worker_threads";
import { AppError } from "../errors/app-error";
import type { TSourceContent, TUploadedSource } from "../types/source";
import type { TEvidence } from "../types/research";
import { read_csv } from "./source-csv";
import { read_pptx } from "./source-pptx";

export const max_source_bytes = 8 * 1024 * 1024;

const read_pdf = async (bytes: Buffer): Promise<TSourceContent> => {
  if (!bytes.subarray(0,1024).includes("%PDF-")) throw new AppError(422,"This file is not a PDF");
  const src = new URL("../workers/pdf-source.ts", import.meta.url);
  const path = existsSync(src) ? src : new URL("../src/workers/pdf-source.ts", import.meta.url);
  const worker = new Worker(path,{ workerData:bytes });
  try {
    return await new Promise<TSourceContent>((resolve,reject) => {
      const timer = setTimeout(() => reject(new AppError(422,"PDF text extraction timed out")),15000);
      worker.once("message", (reply: {content?:TSourceContent;error?:string}) => {
        clearTimeout(timer);
        if (reply.content) resolve(reply.content); else reject(new AppError(422,reply.error ?? "Unreadable PDF"));
      });
      worker.once("error", error => { clearTimeout(timer); reject(error); });
      worker.once("exit", () => { clearTimeout(timer); reject(new AppError(422,"PDF reader stopped")); });
    });
  } finally { await worker.terminate(); }
};

export const parse_source = async (filename: string, bytes: Buffer): Promise<TUploadedSource> => {
  const kind = filename.split(".").at(-1)?.toLowerCase();
  if (kind !== "pdf" && kind !== "pptx" && kind !== "csv") throw new AppError(415,"Choose a text PDF, PPTX or UTF-8 CSV");
  if (!bytes.length) throw new AppError(422,"The file is empty");
  if (bytes.length > max_source_bytes) throw new AppError(413,"File exceeds 8 MiB");
  try {
    const content = kind === "pdf" ? await read_pdf(bytes) : kind === "pptx" ? await read_pptx(bytes) : read_csv(bytes);
    if (!content.records.length) throw new AppError(422,"No extractable text or rows. Paste text or upload a text-based file.");
    return { source_id:crypto.randomUUID(), filename, kind, locations:content.records.length, ...content };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(422,"Could not read the uploaded document. Check the file format.");
  }
};

export const source_evidence = (source: TUploadedSource): TEvidence[] => {
  const prefix = parseInt(createHash("sha256").update(source.source_id).digest("hex").slice(0,12),16);
  const unit = { pptx:"slide", pdf:"page", csv:"CSV row" }[source.kind];
  return source.records.map(row => ({
    id: "F" + prefix + String(row.number).padStart(5,"0"), source_id: source.source_id, origin:"material",
    location: `${source.filename}, ${unit} ${row.number}`, passage:row.text, ...(row.numeric_series && {numeric_series:row.numeric_series}), ...(row.metric && { metric:row.metric }),
  }));
};
