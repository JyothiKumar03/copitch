import { parentPort, workerData } from "node:worker_threads";
import { getDocumentProxy } from "unpdf";
import { page_records } from "../services/source-pages";
import { pdf_page_text } from "../services/pdf-layout";
import type { TPdfTextItem } from "../services/pdf-layout";

try {
  const pdf = await getDocumentProxy(new Uint8Array(workerData), { useSystemFonts: false, useWasm:false,
    useWorkerFetch:false, stopAtErrors:true, maxImageSize:0, disableFontFace:true });
  try {
    if (pdf.numPages > 120) throw Error("PDF exceeds 120 pages");
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
          if (length > 32000) throw Error("PDF exceeds 32,000 extracted characters");
          items.push(item);
        }
      }
      pages.push(pdf_page_text(items));
      page.cleanup();
    }
    parentPort!.postMessage({ content: page_records(pages, "page") });
  } finally { await pdf.loadingTask.destroy(); }
} catch {
  parentPort!.postMessage({ error:"Could not read this PDF within the extraction limits. Supply a shorter, unlocked text PDF." });
}
