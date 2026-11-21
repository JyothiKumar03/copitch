import { posix } from "node:path";
import { fromBufferPromise } from "yauzl";
import { SaxesParser } from "saxes";
import { AppError } from "../errors/app-error";
import { page_records } from "./source-pages";

const xml_parser = () => {
  const parser = new SaxesParser({ xmlns: true });
  parser.on("doctype", () => { throw new AppError(422,"Unsupported XML document type"); });
  return parser;
};

export const read_pptx = async (bytes: Buffer) => {
  const zip = await fromBufferPromise(bytes, { strictFileNames:true, validateEntrySizes:true });
  const parts = new Map<string,string>();
  let expanded = 0;
  try {
    if (zip.entryCount > 3000) throw new AppError(422,"Presentation contains too many parts");
    for await (const entry of zip.eachEntry()) {
      const path = entry.fileName;
      if (!/^ppt\/(presentation\.xml|_rels\/presentation\.xml\.rels|slides\/[^/]+\.xml)$/.test(path)) continue;
      if (parts.has(path) || entry.isEncrypted() || entry.uncompressedSize > 2000000) throw new AppError(422,"Invalid or oversized slide part");
      const stream = await zip.openReadStreamPromise(entry);
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        expanded += chunk.length;
        if (expanded > 8000000) throw new AppError(422,"Presentation XML exceeds the extraction budget");
        chunks.push(chunk);
      }
      parts.set(path,new TextDecoder("utf-8", { fatal:true }).decode(Buffer.concat(chunks)));
    }
  } finally { zip.close(); }

  const rels = parts.get("ppt/_rels/presentation.xml.rels");
  const main = parts.get("ppt/presentation.xml");
  if (!rels || !main) throw new AppError(422,"Missing presentation slide list");
  const targets = new Map<string,string>();
  const relationships = xml_parser();
  relationships.on("opentag", tag => {
    if (tag.local !== "Relationship") return;
    const a = tag.attributes;
    if (!a.Type?.value.endsWith("/slide") || a.TargetMode?.value === "External" || !a.Id || !a.Target) return;
    targets.set(a.Id.value,posix.resolve("/ppt",a.Target.value).slice(1));
  });
  relationships.write(rels).close();
  const pages: string[] = [];
  const presentation = xml_parser();
  presentation.on("opentag", tag => {
    if (tag.local !== "sldId" || !tag.uri.endsWith("/presentationml/main") && !tag.uri.endsWith("/presentationml/2006/main")) return;
    if (pages.length >= 120) throw new AppError(422,"Presentation exceeds 120 slides");
    const relationship = Object.values(tag.attributes).find(a => a.local === "id" && a.uri.endsWith("/relationships"));
    const slide = relationship && parts.get(targets.get(relationship.value) ?? "");
    if (!slide) throw new AppError(422,"A slide is missing from this presentation");
    let content = "", in_text = false;
    const text = (value: string) => { if (in_text) content += value; };
    const text_parser = xml_parser();
    text_parser.on("opentag", node => {
      if (node.local === "t" && /\/drawingml\/(?:2006\/)?main$/.test(node.uri)) in_text = true;
    });
    text_parser.on("text",text);
    text_parser.on("cdata",text);
    text_parser.on("closetag", node => {
      if (in_text && node.local === "t") { in_text = false; content += " "; }
    });
    text_parser.write(slide).close();
    pages.push(content);
  });
  presentation.write(main).close();
  return page_records(pages, "slide");
};
