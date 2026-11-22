import { lookup } from "node:dns/promises";
import { get as http_get } from "node:http";
import { get as https_get } from "node:https";
import { chromium } from "playwright";
import { DEFAULT_WEBSITE_WALKTHROUGH_DEPTH, MAX_WEBSITE_WALKTHROUGH_PAGES, WEBSITE_WALKTHROUGH_DEPTHS } from "../../../shared/website-walkthrough";
import { AppError } from "../errors/app-error";
import { is_public_ipv4 } from "./host-pages";
import { public_url } from "./research";

export type TWebsiteCapturedPage = { url: string; title: string; facts: string[]; screenshot: Buffer; depth?: number };
export type TWebsiteCaptureAttempt = { url: string; status: "captured" | "failed"; observed_url?: string; reason?: string; depth?: number };
export type TWebsiteCaptureResult = { pages: TWebsiteCapturedPage[]; attempts: TWebsiteCaptureAttempt[] };
export type TWebsiteCaptureScope = { max_depth: number; goal: string };

export type TWebsiteResponse = {
  url: string; status: number; location?: string; content_type: string; content_security_policy?: string; body: Buffer;
};
type TWebsiteLink = { url: string; label: string };
type TInspectedPage = Omit<TWebsiteCapturedPage, "url"> & { links: (TWebsiteLink | string)[]; url: string };
type TBrowserElement = {
  href: string;
  innerText: string;
  checkVisibility: (options: { opacityProperty: boolean; visibilityProperty: boolean }) => boolean;
  closest: (selector: string) => TBrowserElement | null;
  getAttribute: (name: string) => string | null;
  getBoundingClientRect: () => { width: number; height: number };
  querySelectorAll: (selector: string) => Iterable<TBrowserElement>;
};
type TBrowserDocument = TBrowserElement & { body: TBrowserElement; title: string; querySelector: (selector: string) => TBrowserElement | null };
type TWebsiteBrowser = {
  capture: (document: TWebsiteResponse, load_asset: (url: string) => Promise<TWebsiteResponse>, signal: AbortSignal) => Promise<TInspectedPage>;
  close: () => Promise<unknown>;
};
export type TWebsiteCaptureServices = {
  resolve: (host: string) => Promise<string[]>;
  read: (url: URL, ipv4: string, max_bytes: number, signal: AbortSignal) => Promise<TWebsiteResponse>;
  launch: () => Promise<TWebsiteBrowser>;
};

const capture_limits = {
  pages: MAX_WEBSITE_WALKTHROUGH_PAGES, attempts: 8, redirects: 3, assets_per_page: 50,
  body_bytes: 2 * 1024 * 1024, assets_bytes_per_page: 10 * 1024 * 1024,
  request_ms: 5_000, page_ms: 15_000, dns_ms: 5_000,
};
const allowed_asset = new Set(["stylesheet", "image", "font", "script"]);
const redirect_status = new Set([301, 302, 303, 307, 308]);
const file_suffix = /\.(?:apk|avi|css|csv|docx?|dmg|exe|gif|gz|ico|jpe?g|js|json|mov|mp[34]|pdf|png|pptx?|svg|tar|ttf|webp|woff2?|xlsx?|xml|zip)$/iu;
const safe_asset_path = /\.(?:avif|css|eot|gif|ico|jpe?g|m?js|otf|png|svg|ttf|webp|woff2?)$/iu;
const excluded_path = /(?:^|\/)(?:auth|delete|download|log-?in|log-?out|oauth|sign-?in|sign-?out|sign-?up)(?:\/|$)/iu;
const secret_query_key = /(?:api[_-]?key|access[_-]?key|auth|credential|password|secret|session|signature|ticket|token)|(?:^|[_-])(?:key|sig|code)(?:$|[_-])/iu;

class WebsiteCaptureError extends Error {}

// Browser calls such as evaluate and close have no deadline of their own. Stop waiting when the signal ends.
export const until_aborted = <T>(work: Promise<T>, signal: AbortSignal) => new Promise<T>((resolve, reject) => {
  if (signal.aborted) { reject(signal.reason); return; }
  const stop = () => reject(signal.reason);
  signal.addEventListener("abort", stop, { once: true });
  work.then(resolve, reject).finally(() => signal.removeEventListener("abort", stop));
});
const settle_within = (work: Promise<unknown>, ms: number) => until_aborted(work, AbortSignal.timeout(ms)).catch(() => {});

export const website_capture_url = (value: string) => {
  const normalized = public_url(value.trim());
  if (!normalized || normalized.length > 2048) return;
  const url = new URL(normalized);
  if (url.port || url.hostname.endsWith(".") || [...url.searchParams.keys()].some(name => secret_query_key.test(name))) return;
  return url;
};

export const same_destination = (from: URL, to: URL) =>
  from.hostname === to.hostname && (from.protocol === to.protocol || from.protocol === "http:" && to.protocol === "https:");

const safe_path = (target: URL) => {
  try {
    return !excluded_path.test(decodeURIComponent(target.pathname));
  } catch {
    return false;
  }
};

const discover_url = (from: URL, value: string) => {
  const target = website_capture_url(value);
  if (!target || !same_destination(from, target) || target.search || file_suffix.test(target.pathname)) return;
  return safe_path(target) ? target : undefined;
};

const navigation_intents = [
  { goal: /\b(?:learn(?:ing)?|basics?|beginners?|intro(?:duction)?|get(?:ting)? started|tutorials?)\b/iu,
    direct: /\b(?:get(?:ting)?[\s/-]*started|beginners?|tutorials?|intro(?:duction)?|learn(?:ing)?)\b/iu,
    related: /\b(?:about|overview|doc(?:s|umentation)?|guides?)\b/iu },
  { goal: /\b(?:downloads?|install(?:ation)?|releases?|supported versions?)\b/iu,
    direct: /\b(?:downloads?|install(?:ation)?|releases?|supported versions?)\b/iu,
    related: /\b(?:versions?|availability|distribution)\b/iu },
];
const rank_words = (value: string) => [...new Set(value.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])]
  .map(word => /^[a-z]{4,}s$/u.test(word) && !/(?:ss|us|is)$/u.test(word) ? word.slice(0, -1) : word);
const common_goal_words = new Set("and are for from has how into its our that the their there these this those through via was were what where which while who will with you your".split(" "));

const link_relevance = (goal: string, host: string) => {
  const generic = new Set(rank_words(host));
  const wanted = new Set(rank_words(goal).filter(word => !generic.has(word) && !common_goal_words.has(word)));
  const intents = navigation_intents.filter(intent => intent.goal.test(goal));
  const matches = (value: string) => rank_words(value).filter(word => wanted.has(word)).length;
  return (url: URL, label: string) => {
    const path = decodeURIComponent(url.pathname);
    const leaf = path.split("/").filter(Boolean).at(-1)?.replace(/[-_]/gu, " ") ?? "";
    const purpose_label = label.replace(/\b(?:learn|read|find out) more(?: about)?\b/giu, " ");
    const purpose = intents.reduce((score, intent) => score +
      (intent.direct.test(purpose_label) || intent.direct.test(leaf) ? 4 :
        intent.related.test(purpose_label) || intent.related.test(leaf) ? 2 : 0), 0);
    return purpose + matches(purpose_label) * 2 + matches(path);
  };
};

export const resolve_ipv4: TWebsiteCaptureServices["resolve"] = async host =>
  (await lookup(host, { family: 4, all: true })).map(result => result.address);

// The socket dials only the resolved IPv4 address. TLS certificate checks and SNI still use the approved hostname.
export const read_pinned: TWebsiteCaptureServices["read"] = (url, ipv4, max_bytes, signal) =>
  new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const get = url.protocol === "https:" ? https_get : http_get;
    const request = get({
      hostname: ipv4, path: url.pathname + url.search, servername: url.hostname, agent: false, signal,
      headers: { Host: url.host, Accept: "*/*", "Accept-Encoding": "identity", "User-Agent": "Mozilla/5.0 (compatible; copitch website capture)" },
    }, response => {
      response.once("error", reject);
      const status = response.statusCode ?? 0;
      const headers = response.headers;
      const csp = headers["content-security-policy"];
      const observed = { url: url.href, status, location: headers.location, content_type: headers["content-type"] ?? "",
        content_security_policy: Array.isArray(csp) ? csp.join(", ") : csp };
      if (status < 200 || status >= 300) {
        resolve({ ...observed, body: Buffer.alloc(0) });
        response.destroy();
        return;
      }
      if (Number(headers["content-length"]) > max_bytes || headers["content-encoding"] && headers["content-encoding"] !== "identity") {
        response.destroy(new WebsiteCaptureError("The page resource could not be read within the capture limits."));
        return;
      }
      const chunks: Buffer[] = [];
      let total = 0;
      response.on("data", (chunk: Buffer) => {
        total += chunk.length;
        if (total > max_bytes) {
          response.destroy(new WebsiteCaptureError("The page resource exceeds the capture size limit."));
          return;
        }
        chunks.push(chunk);
      });
      response.once("aborted", () => reject(new WebsiteCaptureError("The page resource was interrupted.")));
      response.once("end", () => resolve({ ...observed, body: Buffer.concat(chunks) }));
    });
    request.once("error", reject);
  });

const launch_browser = async (): Promise<TWebsiteBrowser> => {
  const browser = await chromium.launch({
    ...(process.env.DECK_RENDER_CHROMIUM ? { executablePath: process.env.DECK_RENDER_CHROMIUM } : { channel: "chrome" }),
    env: Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined &&
      ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "USER", "DISPLAY"].includes(key))),
    // Only the service's pinned GET transport may reach the website. Chrome receives intercepted content in memory.
    args: ["--disable-dev-shm-usage", "--disable-background-networking", "--disable-quic",
      "--proxy-server=http://127.0.0.1:1", "--proxy-bypass-list=<-loopback>",
      "--host-resolver-rules=MAP * ~NOTFOUND", "--force-webrtc-ip-handling-policy=disable_non_proxied_udp"],
    timeout: 10_000,
  });
  return {
    close: () => settle_within(browser.close(), 5_000),
    capture: async (document_response, load_asset, signal) => {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1,
        serviceWorkers: "block", acceptDownloads: false });
      const stop = () => { void context.close().catch(() => {}); };
      signal.addEventListener("abort", stop, { once: true });
      try {
        signal.throwIfAborted();
        await context.routeWebSocket("**/*", socket => { void socket.close(); });
        const page = await context.newPage();
        context.on("page", opened => { if (opened !== page) void opened.close().catch(() => {}); });
        let rendered_document = false;
        await context.route("**/*", async route => {
          try {
            const request = route.request();
            if (signal.aborted || request.method() !== "GET") { await route.abort(); return; }
            if (request.isNavigationRequest()) {
              if (rendered_document || request.url() !== document_response.url || request.frame() !== page.mainFrame()) {
                await route.abort();
                return;
              }
              rendered_document = true;
              const policy = "form-action 'none'; frame-src 'none'; object-src 'none'; connect-src 'none'; base-uri 'self'";
              await route.fulfill({ status: document_response.status, body: document_response.body, headers: {
                "content-type": document_response.content_type,
                "content-security-policy": [document_response.content_security_policy, policy].filter(Boolean).join(", "),
              } });
              return;
            }
            if (!allowed_asset.has(request.resourceType())) { await route.abort(); return; }
            const asset = await load_asset(request.url());
            if (asset.status < 200 || asset.status >= 300) { await route.abort(); return; }
            await route.fulfill({ status: asset.status, body: asset.body, contentType: asset.content_type });
          } catch { await route.abort().catch(() => {}); }
        });
        await page.goto(document_response.url, { waitUntil: "commit", timeout: capture_limits.page_ms });
        await page.locator("body").waitFor({ state: "visible", timeout: 4_000 });
        await page.waitForLoadState("domcontentloaded", { timeout: 2_000 }).catch(() => {});
        const content = await page.evaluate(() => {
          const { document } = globalThis as typeof globalThis & { document: TBrowserDocument };
          const visible = (node: TBrowserElement) => {
            const box = node.getBoundingClientRect();
            return box.width > 0 && box.height > 0 && node.checkVisibility({ opacityProperty: true, visibilityProperty: true });
          };
          const clean = (value: string) => value.replace(/\s+/gu, " ").trim();
          const main = document.querySelector("main,[role=main],article") ?? document.body;
          // Keep statements and figures. Short labels such as "Status" or "What I build" are navigation, not facts.
          const facts = [...new Set([...main.querySelectorAll("h1,h2,h3,p,li,dd,blockquote,figcaption")]
            .filter(node => visible(node) && !node.closest("header,nav,footer,form,[aria-hidden=true]"))
            .map(node => clean(node.innerText).slice(0, 340))
            .filter(text => text.split(" ").length >= 4 || /\d/u.test(text) && text.split(" ").length >= 2))].slice(0, 12);
          if (!facts.length && visible(main)) {
            const text = clean(main.innerText).slice(0, 340);
            if (text) facts.push(text);
          }
          const links = [...document.querySelectorAll("a[href]:not([download])")]
            .filter(node => visible(node) && !node.closest("form") && !!(clean(node.innerText) || node.getAttribute("aria-label")))
            .slice(0, 80).map(node => ({ url: node.href, label: clean(node.innerText || node.getAttribute("aria-label") || "").slice(0, 160) }));
          return { title: clean(document.title || facts[0] || "").slice(0, 160), facts, links,
            requires_login: [...document.querySelectorAll("input[type=password]")].some(visible) };
        });
        if (content.requires_login && content.facts.length < 2) throw new WebsiteCaptureError("The page requires sign-in.");
        if (!content.facts.length) throw new WebsiteCaptureError("The page did not expose any visible content.");
        const screenshot = await page.screenshot({ type: "jpeg", quality: 82, fullPage: false, animations: "disabled", timeout: 4_000 });
        return { url: page.url(), title: content.title, facts: content.facts, links: content.links, screenshot };
      } finally {
        signal.removeEventListener("abort", stop);
        await settle_within(context.close(), 3_000);
      }
    },
  };
};

const default_services = { resolve: resolve_ipv4, read: read_pinned, launch: launch_browser };

const find_address = async (services: TWebsiteCaptureServices, host: string, signal: AbortSignal) => {
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(capture_limits.dns_ms)]);
  deadline.throwIfAborted();
  let on_abort: () => void = () => {};
  const stopped = new Promise<never>((_resolve, reject) => {
    on_abort = () => reject(deadline.reason);
    deadline.addEventListener("abort", on_abort, { once: true });
  });
  try {
    const addresses = await Promise.race([services.resolve(host), stopped]);
    if (!addresses.length || !addresses.every(is_public_ipv4)) throw new WebsiteCaptureError("The approved host does not resolve exclusively to a public IPv4 address.");
    return addresses[0];
  } finally { deadline.removeEventListener("abort", on_abort); }
};

// A bare domain often serves a certificate or redirect only for its www host. When nothing on the approved
// apex could be captured, try the same site under www before reporting the walkthrough as empty.
export const capture_website = async (value: string, signal: AbortSignal, observe?: (attempt: TWebsiteCaptureAttempt) => void,
  overrides: Partial<TWebsiteCaptureServices> = {}, scope: TWebsiteCaptureScope = {
    max_depth: DEFAULT_WEBSITE_WALKTHROUGH_DEPTH, goal: "",
  }): Promise<TWebsiteCaptureResult> => {
  const first = await capture_site(value, signal, observe, overrides, scope);
  const root = website_capture_url(value);
  if (first.pages.length || !root || root.hostname.startsWith("www.") || root.hostname.split(".").length !== 2) return first;
  const alternate = new URL(root);
  alternate.hostname = "www." + root.hostname;
  const retry = await capture_site(alternate.href, signal, observe, overrides, scope);
  const reason = `This address did not open, often because its certificate covers only ${alternate.hostname}. Captured ${alternate.hostname} instead.`;
  return { pages: retry.pages, attempts: [...(retry.pages.length ? first.attempts.map(attempt => ({ ...attempt, reason })) : first.attempts), ...retry.attempts] };
};

const capture_site = async (value: string, signal: AbortSignal, observe: ((attempt: TWebsiteCaptureAttempt) => void) | undefined,
  overrides: Partial<TWebsiteCaptureServices>, scope: TWebsiteCaptureScope): Promise<TWebsiteCaptureResult> => {
  const services = { ...default_services, ...overrides };
  const root = website_capture_url(value);
  if (!root) throw new AppError(422, "Enter a public HTTP or HTTPS website on its standard port.");
  const { max_depth, goal } = scope;
  if (!WEBSITE_WALKTHROUGH_DEPTHS.some(allowed => allowed === max_depth)) {
    throw new AppError(422, `Choose a crawl depth from 0 to ${WEBSITE_WALKTHROUGH_DEPTHS.at(-1)}.`);
  }
  const relevance = link_relevance(goal, root.hostname);
  const result: TWebsiteCaptureResult = { pages: [], attempts: [] };
  const started = performance.now();
  const record = (attempt: TWebsiteCaptureAttempt) => {
    result.attempts.push(attempt); observe?.(attempt);
    if (process.env.TRACE_LOGS === "1") console.log(JSON.stringify({ operation: "website.capture_attempt", status: attempt.status,
      depth: attempt.depth, elapsed_ms: Math.round(performance.now() - started) }));
  };
  const failure = (error: unknown, default_message: string) => error instanceof WebsiteCaptureError ? error.message : default_message;
  let address: string;
  try { address = await find_address(services, root.hostname, signal); }
  catch (error) {
    signal.throwIfAborted();
    record({ url: root.href, status: "failed", depth: 0, reason: failure(error, "The approved host could not be resolved.") });
    return result;
  }
  const read = async (initial: URL, max_bytes: number, page_signal: AbortSignal, asset = false) => {
    let url = initial;
    for (let hop = 0; hop <= capture_limits.redirects; hop++) {
      page_signal.throwIfAborted();
      if (!safe_path(url) || asset && !safe_asset_path.test(url.pathname)) {
        throw new WebsiteCaptureError("The page tried to open an account, action, or unsupported asset route.");
      }
      const response = await services.read(url, address, max_bytes, AbortSignal.any([page_signal, AbortSignal.timeout(capture_limits.request_ms)]));
      if (!redirect_status.has(response.status)) return { ...response, url: url.href };
      const next = response.location && website_capture_url(new URL(response.location, url).href);
      if (!next || !same_destination(url, next) || !same_destination(root, next)) {
        throw new WebsiteCaptureError("The page redirected outside the approved website.");
      }
      url = next;
    }
    throw new WebsiteCaptureError("The page redirected too many times.");
  };
  let browser: TWebsiteBrowser;
  try { browser = await services.launch(); }
  catch {
    signal.throwIfAborted();
    throw new AppError(503, "The website browser is unavailable. Try again shortly.");
  }
  const visited = new Set<string>();
  const queue = [{ current: root, depth: 0 }];
  const queued = new Set([root.href]);
  try {
    for (const { current, depth } of queue) {
      signal.throwIfAborted();
      if (result.pages.length >= capture_limits.pages || result.attempts.length >= capture_limits.attempts) break;
      if (visited.has(current.href)) continue;
      visited.add(current.href);
      const page_signal = AbortSignal.any([signal, AbortSignal.timeout(capture_limits.page_ms)]);
      let observed_url: string | undefined;
      let attempt: TWebsiteCaptureAttempt;
      try {
        const document = await read(current, capture_limits.body_bytes, page_signal);
        observed_url = document.url;
        if (visited.has(document.url) && document.url !== current.href) continue;
        visited.add(document.url);
        if (document.status < 200 || document.status >= 300) throw new WebsiteCaptureError(`The site returned HTTP ${document.status}.`);
        if (!/^(?:text\/html|application\/xhtml\+xml)(?:;|$)/iu.test(document.content_type.trim())) {
          throw new WebsiteCaptureError("The address did not open a web page.");
        }
        let asset_count = 0;
        let asset_bytes = capture_limits.assets_bytes_per_page;
        const observed = new URL(document.url);
        const captured = await until_aborted(browser.capture(document, async asset => {
          const candidate = website_capture_url(asset);
          if (!candidate || !same_destination(observed, candidate) || asset_count >= capture_limits.assets_per_page || asset_bytes <= 0) {
            throw new WebsiteCaptureError("The asset is outside the approved page or capture limits.");
          }
          asset_count++;
          const reserved_bytes = Math.min(capture_limits.body_bytes, asset_bytes);
          asset_bytes -= reserved_bytes;
          const response = await read(candidate, reserved_bytes, page_signal, true);
          asset_bytes += Math.max(0, reserved_bytes - response.body.length);
          return response;
        }, page_signal), page_signal);
        if (captured.url !== document.url || !captured.screenshot.length) throw new WebsiteCaptureError("The page changed before it could be captured.");
        result.pages.push({ url: captured.url, title: captured.title || observed.hostname, facts: captured.facts, screenshot: captured.screenshot, depth });
        attempt = { url: current.href, observed_url, status: "captured", depth };
        if (depth < max_depth) {
          const children = captured.links.flatMap(candidate => {
            const { url, label } = typeof candidate === "string" ? { url: candidate, label: "" } : candidate;
            const link = discover_url(observed, url);
            return link ? [{ link, score: relevance(link, label) }] : [];
          }).sort((first, second) => second.score - first.score);
          for (const { link } of children) {
            if (queued.has(link.href)) continue;
            if (queue.length >= capture_limits.attempts) break;
            queue.push({ current: link, depth: depth + 1 });
            queued.add(link.href);
          }
        }
      } catch (error) {
        signal.throwIfAborted();
        attempt = { url: current.href, observed_url, status: "failed", depth,
          reason: failure(error, page_signal.aborted ? "The page timed out before it could be captured." : "The page could not be opened and captured.") };
      }
      record(attempt);
    }
  } finally { await settle_within(browser.close(), 5_000); }
  return result;
};
