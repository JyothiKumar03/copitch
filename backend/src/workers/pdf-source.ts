import { parentPort, workerData } from "node:worker_threads";
import { getDocumentProxy } from "unpdf";
import { page_records } from "../services/source-pages";
import { pdf_page_text } from "../services/pdf-layout";
import type { TPdfTextItem } from "../services/pdf-layout";

// Uploads pass only bytes and use the upload limits. Research reads pass larger page and character limits.
const input = workerData as Uint8Array | { bytes: Uint8Array; pages: number; characters: number };
const { bytes, pages: max_pages, characters: max_characters } = "bytes" in input && !(input instanceof Uint8Array)
  ? input : { bytes: input as Uint8Array, pages: 120, characters: 32_000 };

try {
  const pdf = await getDocumentProxy(new Uint8Array(bytes), { useSystemFonts: false, useWasm:false,
    useWorkerFetch:false, stopAtErrors:true, maxImageSize:0, disableFontFace:true });
  try {
    if (pdf.numPages > max_pages) throw Error(`PDF exceeds ${max_pages} pages`);
    const pages: string[] = [];
    let length = 0;
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const items: TPdfTextItem[] = [];
      const stream = page.streamTextContent().getReader();
      for (;;) {
        const { done, value } = await stream.read();
        if (done) break;
        for (const item of value.items) {
          if (!("str" in item)) continue;
          length += item.str.length + 1;
          if (length > max_characters) throw Error("PDF exceeds its extracted character limit");
          items.push(item);
        }
      }
      pages.push(pdf_page_text(items));
      page.cleanup();
    }
    parentPort!.postMessage({ content: page_records(pages, "page", max_characters) });
  } finally { await pdf.loadingTask.destroy(); }
} catch {
  parentPort!.postMessage({ error:"Could not read this PDF within the extraction limits. Supply a shorter, unlocked text PDF." });
}
