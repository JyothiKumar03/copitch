import type { TSourceContent, TSourceRecord } from "../types/source";
import { AppError } from "../errors/app-error";

export const page_records = (pages: string[], kind: "page" | "slide"): TSourceContent => {
  let total = 0, empty = 0;
  const records: TSourceRecord[] = [];
  for (const [i, raw] of pages.entries()) {
    const text = kind === "page"
      ? raw.split("\n").map(line => line.replace(/\s+/gu, " ").trim()).filter(Boolean).join("\n")
      : raw.replace(/\s+/gu, " ").trim();
    if (!text) { empty++; continue; }
    total += text.length;
    if (total > 32000) throw new AppError(422,"Document exceeds 32,000 extracted characters. Upload a shorter selection.");
    records.push({ number:i + 1,text });
  }
  return { records,gaps: empty ? [`${empty} ${kind}(s) contained no extractable text.`] : [] };
};
