import { lookup } from "node:dns/promises";
import { get as http_get } from "node:http";
import { get as https_get } from "node:https";
import type { RequestOptions } from "node:https";
import { BlockList } from "node:net";
import { public_url } from "./research";
import { parse_source } from "./source";
import { research_pdf_limits } from "../constants/sources";
import type { TSearchHit } from "../types/research";

const private_networks = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.168.0.0", 16], ["192.88.99.0", 24], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 3],
] as const) private_networks.addSubnet(address, prefix);

const max_page_bytes = 2 * 1024 * 1024;
const download_types = new Set(["application/octet-stream", "application/force-download", "application/x-download", "application/download", "binary/octet-stream"]);
const max_links = 40;
export type TResearchLink = { url: string; label: string; kind: "page" | "pdf" };
export type TPageDiscovery = { url: string; hits: TSearchHit[]; links: TResearchLink[] };
type TDownload = { redirect: string } | { html: string } | { text: string } | { pdf: Buffer };
type TDownloadPage = (url: URL, signal: AbortSignal) => Promise<TDownload>;

const read_page = async (url: URL, signal: AbortSignal) => {
  signal.throwIfAborted();
  const { address } = await lookup(url.hostname, { family: 4 });
  signal.throwIfAborted();
  if (private_networks.check(address)) throw new Error("The page does not resolve to a public address.");
  const get = url.protocol === "https:" ? https_get : http_get;
  const options: RequestOptions = {
    hostname: address, port: url.port, path: url.pathname + url.search, servername: url.hostname,
    signal, agent: false, headers: { Host: url.host, Accept: "text/html,application/pdf,text/plain", "Accept-Encoding": "identity" },
  };
  return new Promise<TDownload>((resolve, reject) => {
    const request = get(options, response => {
      const { location } = response.headers;
      if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0) && location) {
        response.destroy();
        resolve({ redirect: location });
        return;
      }
      const type = (response.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
      // Report sites often serve PDFs as generic downloads (download.php?file=report.pdf); the body is checked below.
      const pdf = type === "application/pdf" || download_types.has(type);
      const plain_text = type === "text/plain" && /\.txt$/i.test(url.pathname);
      const max_bytes = pdf ? research_pdf_limits.bytes : max_page_bytes;
      if (response.statusCode !== 200 || (!pdf && !plain_text && type !== "text/html") ||
          Number(response.headers["content-length"]) > max_bytes) {
        response.destroy();
        reject(new Error("The reference did not return a readable HTML page, PDF, or text file."));
        return;
      }
      const chunks: Buffer[] = [];
      let bytes = 0;
      response.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > max_bytes) response.destroy(new Error("The reference was too large."));
        else chunks.push(chunk);
      });
      response.once("error", reject);
      response.once("aborted", () => reject(new Error("The page download was interrupted.")));
      response.once("end", () => {
        const body = Buffer.concat(chunks);
        if (pdf && body.subarray(0, 1024).includes("%PDF-")) resolve({ pdf: body });
        else if (pdf) reject(new Error("The download was not a PDF."));
        else if (plain_text) resolve({ text: body.toString("utf8") });
        else resolve({ html: body.toString("utf8") });
      });
    });
    request.once("error", reject);
  });
};

const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", rsquo: "\u2019", lsquo: "\u2018",
  rdquo: "\u201d", ldquo: "\u201c", ndash: "\u2013", mdash: "\u2014", hellip: "\u2026", middot: "\u00b7", copy: "\u00a9", reg: "\u00ae", trade: "\u2122" };
const decode = (text: string) => text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/giu, (whole, name: string) => {
  const code = name[0] !== "#" ? undefined : name[1].toLowerCase() === "x" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
  return code !== undefined ? (code <= 0x10ffff ? String.fromCodePoint(code) : "\ufffd") : entities[name.toLowerCase()] ?? whole;
});
const hidden_tags = new Set(["head", "script", "style", "noscript", "template", "svg", "iframe"]);
const void_elements = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
const block_tags = new Set(["p", "li", "dt", "dd", "h1", "h2", "h3", "h4", "h5", "h6", "div", "section",
  "article", "header", "footer", "nav", "main", "aside", "tr", "blockquote", "pre", "figcaption"]);
const separated_tags = new Set(["a", "button", "label", "td", "th", "span"]);

// Visible text only, with block boundaries kept as line breaks so sentences from different blocks never run together.
const page_text = (html: string) => {
  let hidden_content = false;
  let title = "";
  const parts: string[] = [];
  const links: { href: string; label: string }[] = [];
  let active_link: (typeof links)[number] | undefined;
  const append = (text: string) => {
    if (hidden_content) return;
    parts.push(text);
    if (active_link && active_link.label.length < 160) active_link.label += text.slice(0, 160 - active_link.label.length);
  };
  new HTMLRewriter()
    .on("title", { text: chunk => { if (title.length < 200) title += chunk.text; } })
    .on("*", { element: element => {
      if (hidden_content) return;
      const tag = element.tagName;
      if (hidden_tags.has(tag) || element.hasAttribute("hidden") || element.getAttribute("aria-hidden")?.toLowerCase() === "true") {
        if (!void_elements.has(tag)) {
          hidden_content = true;
          element.onEndTag(() => { hidden_content = false; });
        }
        return;
      }
      const separator = block_tags.has(tag) || tag === "br" ? "\n" : separated_tags.has(tag) ? " " : undefined;
      if (separator) append(separator);
      const href = tag === "a" && links.length < 200 ? element.getAttribute("href")?.trim() : undefined;
      const link = href && !href.startsWith("#") ? { href, label: "" } : undefined;
      if (link) { links.push(link); active_link = link; }
      if (!void_elements.has(tag) && (link || separator)) element.onEndTag(() => {
        if (active_link === link) active_link = undefined;
        if (separator) append(separator);
      });
    } })
    .on("body", { text: chunk => { append(chunk.text); } })
    .transform(html);
  const lines = decode(parts.join("")).split("\n").map(line => line.split(/\s+/u).filter(Boolean).join(" ")).filter(Boolean);
  return { title: decode(title).trim(), text: lines.join("\n").slice(0, 24_000), links };
};

// Passages end at block boundaries; a single long block is split between sentences.
const sentences = new Intl.Segmenter("en", { granularity: "sentence" });
const passages = (text: string, size = 1400) => {
  const out: string[] = [];
  let current = "";
  const add = (piece: string) => {
    if (current && current.length + piece.length + 1 > size) { out.push(current); current = ""; }
    current = current ? current + "\n" + piece : piece;
  };
  for (const line of text.split("\n")) {
    if (line.length <= size) { add(line); continue; }
    for (const { segment } of sentences.segment(line)) {
      const sentence = segment.trim();
      for (let index = 0; index < sentence.length; index += size) add(sentence.slice(index, index+size));
    }
  }
  if (current) out.push(current);
  return out;
};

const pdf_passages = (text: string) => {
  let columns = "";
  return passages(text, 1100).map(passage => {
    const header = passage.split("\n").find(line => line.startsWith("Columns: "));
    if (header) { columns = header; return passage; }
    return columns && passage.includes(" | ") ? columns + "\n" + passage : passage;
  });
};

const is_pdf = (path: string) => /\.pdf$/i.test(path);
const asset = (path: string) => /\.(?:png|jpe?g|gif|svg|webp|ico|css|js|woff2?|zip|xml|json)$/i.test(path);
const same_site = (a: URL, b: URL) => a.hostname.replace(/^www\./, "") === b.hostname.replace(/^www\./, "") &&
  (a.protocol === b.protocol || (a.protocol === "http:" && b.protocol === "https:"));

export const research_url = (value: string) => {
  const safe = public_url(value);
  return safe && !new URL(safe).port && safe.length <= 2048 ? safe : undefined;
};

export const research_link = (url: string, label: string): TResearchLink | undefined => {
  const safe = research_url(url);
  if (!safe) return;
  const { pathname } = new URL(safe);
  if (asset(pathname)) return;
  return { url: safe, label: label.trim().slice(0, 160) || pathname, kind: is_pdf(pathname) ? "pdf" : "page" };
};

// Follow redirects with the public-address check on every hop, then keep the page text and its same-site links.
const fetch_page = async (value: string, signal: AbortSignal, download: TDownloadPage): Promise<TPageDiscovery> => {
  const root = research_url(value);
  if (!root) throw new Error("The reference must be a public HTTP or HTTPS URL.");
  let url = new URL(root);
  for (let hop = 0; hop <= 3; hop++) {
    signal.throwIfAborted();
    const response = await download(url, signal);
    signal.throwIfAborted();
    if ("redirect" in response) {
      const destination = research_url(new URL(response.redirect, url).href);
      if (!destination || !same_site(url, new URL(destination))) throw new Error("The page redirected outside the approved site.");
      url = new URL(destination);
      continue;
    }
    if ("pdf" in response) {
      const filename = url.pathname.split("/").at(-1) || "Document";
      const pdf = await parse_source(is_pdf(filename) ? filename : `${filename}.pdf`, response.pdf, research_pdf_limits);
      signal.throwIfAborted();
      const hits = pdf.records.flatMap(row => pdf_passages(row.text).map(passage => ({
        url: url.href, title: `${pdf.filename}, page ${row.number}`, passage,
      })));
      return { url: url.href, hits, links: [] };
    }
    if ("text" in response) {
      const title = url.pathname.split("/").at(-1) || url.hostname;
      const hits = passages(response.text.trim().slice(0, 24_000)).map(passage => ({ url: url.href, title, passage }));
      return { url: url.href, hits, links: [] };
    }
    const page = page_text(response.html);
    const links = new Map<string, TResearchLink>();
    for (const item of page.links) {
      try {
        const destination = new URL(decode(item.href), url);
        if (!same_site(url, destination)) continue;
        const link = research_link(destination.href, decode(item.label).replace(/\s+/gu, " "));
        if (link && link.url !== url.href && !links.has(link.url)) links.set(link.url, link);
      } catch { /* Skip malformed page links. */ }
    }
    const title = (page.title || url.pathname).slice(0, 200);
    return { url: url.href, hits: passages(page.text).map(passage => ({ url: url.href, title, passage })),
      links: [...links.values()].slice(0, max_links) };
  }
  throw new Error("The reference redirected too many times.");
};

// Any way a site address can be written ("jk-ai.in", "http://JK-AI.in/") becomes one https address, or nothing.
export const site_url = (value: string) => {
  try {
    const url = new URL(value.trim().includes("://") ? value.trim() : "https://" + value.trim());
    url.protocol = "https:"; url.hostname = url.hostname.toLowerCase(); url.port = ""; url.hash = "";
    return public_url(url.href);
  } catch { return undefined; }
};
// A bare domain is tried with www. first (and a www. one without it), because many apex domains only park a redirect.
const site_hosts = (value: string) => {
  const url = new URL(value);
  const other = url.hostname.startsWith("www.") ? url.hostname.slice(4) : "www." + url.hostname;
  const alternate = Object.assign(new URL(url.href), { hostname: other }).href;
  return url.hostname.startsWith("www.") ? [url.href, alternate] : [alternate, url.href];
};
const readable = 200; // characters of visible text: below this a page is a redirect shell, a parking page or empty

export const read_host_page = async (
  value: string, parent: AbortSignal, options: { try_www?: boolean; download?: TDownloadPage; timeout_ms?: number } = {},
): Promise<TPageDiscovery> => {
  const safe = research_url(value);
  if (!safe) throw new Error("The reference must be a public HTTP or HTTPS URL.");
  const site = new URL(safe);
  const candidates = options.try_www && site.pathname === "/" && !site.search ? site_hosts(safe) : [safe];
  let best: TPageDiscovery | undefined;
  let longest = -1;
  let failure: unknown;
  for (const candidate of candidates) {
    parent.throwIfAborted();
    try {
      const page = await fetch_page(candidate, AbortSignal.any([parent, AbortSignal.timeout(options.timeout_ms ?? 10_000)]), options.download ?? read_page);
      const length = page.hits.reduce((size, hit) => size + hit.passage.length, 0);
      if (length >= readable) return page;
      if (length > longest) { best = page; longest = length; }
    } catch (cause) { failure = cause; }
  }
  parent.throwIfAborted();
  if (best) return best;
  throw failure instanceof Error ? failure : new Error("The site could not be reached.");
};
