import { parentPort, workerData } from "node:worker_threads";
import { getDocumentProxy } from "unpdf";
import { page_records } from "../services/source-pages";

try {
  const pdf = await getDocumentProxy(new Uint8Array(workerData), { useSystemFonts: false, useWasm:false,
    useWorkerFetch:false, stopAtErrors:true, maxImageSize:0, disableFontFace:true });
  try {
    if (pdf.numPages > 120) throw Error("PDF exceeds 120 pages");
    const pages: string[] = [];
    let length = 0;
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      let text = "";
      const stream = page.streamTextContent().getReader();
      for (;;) {
        const { done, value } = await stream.read();
        if (done) break;
        for (const item of value.items) {
          if (typeof item.str !== "string") continue;
          length += item.str.length + 1;
          if (length > 32000) throw Error("PDF exceeds 32,000 extracted characters");
          text += item.str + " ";
        }
      }
      pages.push(text);
      page.cleanup();
    }
    parentPort!.postMessage({ content: page_records(pages, "page") });
  } finally { await pdf.loadingTask.destroy(); }
} catch {
  parentPort!.postMessage({ error:"Could not read this PDF within the extraction limits. Supply a shorter, unlocked text PDF." });
}
