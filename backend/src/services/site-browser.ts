import { chromium } from "playwright";
import type { ElementHandle } from "playwright";
import { AppError } from "../errors/app-error";
import type { TSiteElement, TSiteObservation } from "../types/site-run";
import { is_public_ipv4 } from "./host-pages";
import { read_pinned, resolve_ipv4, until_aborted } from "./website-capture";
import type { TWebsiteCaptureServices } from "./website-capture";
import { site_navigation, site_wall_reason } from "./site-policy";
import type { TSiteWallKind } from "../../../shared/site-run";

export class SiteWall extends Error {
  constructor(readonly kind: TSiteWallKind) { super(site_wall_reason[kind]); }
}

export type TSiteBrowser = {
  open: (url: string) => Promise<void>;
  observe: () => Promise<TSiteObservation>;
  click: (ref: string) => Promise<void>;
  select: (ref: string, option: string) => Promise<void>;
  show_example?: (ref: string) => Promise<void>;
  scroll: (direction: "up" | "down") => Promise<void>;
  close: () => Promise<void>;
};

type TBrowserControl = {
  tagName: string; type?: string; form?: unknown; innerText?: string; title?: string; href?: string;
  textContent?: string; labels?: { textContent: string | null }[];
  options?: Iterable<{ label: string; disabled: boolean }>;
  checkVisibility: (options: { opacityProperty: boolean; visibilityProperty: boolean }) => boolean;
  getAttribute: (name: string) => string | null;
  getBoundingClientRect: () => { top: number; bottom: number; left: number; right: number; width: number; height: number };
  matches: (selector: string) => boolean;
  querySelectorAll: (selector: string) => Iterable<TBrowserControl>;
  closest: (selector: string) => TBrowserControl | null;
};
type TBrowserDocument = TBrowserControl & {
  body: TBrowserControl; querySelector: (selector: string) => TBrowserControl | null;
  getElementById: (id: string) => TBrowserControl | null;
  elementFromPoint: (x: number, y: number) => TBrowserControl | null;
};

const page_csp = "form-action 'none'; frame-src 'none'; object-src 'none'; connect-src 'none'; worker-src 'none'; base-uri 'self'";
const resources = new Set(["stylesheet", "image", "font", "script"]);
const redirect = new Set([301, 302, 303, 307, 308]);
const max_document_bytes = 2 * 1024 * 1024;
const max_asset_bytes = 10 * 1024 * 1024;
const interactive = "a[href]:not([download]),button,[role=tab],[role=button],[role=switch],select";
const visual_private_fields = "input, textarea, select, [contenteditable=true]";
const close_quickly = async (closing: Promise<unknown>) => {
  await until_aborted(closing, AbortSignal.timeout(700)).catch(() => {});
};

// Resolve only static public raster originals. The optimizer itself never receives a request.
const next_image_original = (root: URL, target: URL, resource: string) => {
  if (resource !== "image" || target.origin !== root.origin || target.username || target.password || target.hash ||
    target.pathname !== "/_next/image" || target.href.length > 2048) return;
  const parameters = target.searchParams;
  for (const [key, value] of parameters) {
    if (!["url", "w", "q"].includes(key) || parameters.getAll(key).length !== 1) return;
    if (key !== "url" && !/^[1-9][0-9]{0,3}$/u.test(value)) return;
  }
  const path = parameters.get("url");
  if (!path || !/^\/(?:images|assets|_next\/static\/media)\/(?:[a-z0-9_-]+\/)*[a-z0-9_-]+(?:\.[a-z0-9_-]+)*\.(?:avif|gif|jpe?g|png|webp)$/iu.test(path) ||
    /\/(?:private|sessions?|accounts?|admin|api|uploads?)(?:\/|\.)/iu.test(path)) return;
  return new URL(path, root);
};

export const open_site_browser = async (root: URL, signal: AbortSignal, transport: Pick<TWebsiteCaptureServices, "read" | "resolve"> = {
  read: read_pinned, resolve: resolve_ipv4,
}, goal = ""): Promise<TSiteBrowser> => {
  const addresses = await until_aborted(transport.resolve(root.hostname), AbortSignal.any([signal, AbortSignal.timeout(5_000)]));
  if (!addresses.length || !addresses.every(is_public_ipv4)) throw new AppError(422, "The website must resolve to public addresses only.");
  const browser = await chromium.launch({
    ...(process.env.DECK_RENDER_CHROMIUM ? { executablePath: process.env.DECK_RENDER_CHROMIUM } : { channel: "chrome" }),
    env: Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined &&
      ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "USER", "DISPLAY"].includes(key))),
    args: ["--disable-dev-shm-usage", "--disable-background-networking", "--disable-quic",
      "--proxy-server=http://127.0.0.1:1", "--proxy-bypass-list=<-loopback>", "--host-resolver-rules=MAP * ~NOTFOUND",
      "--force-webrtc-ip-handling-policy=disable_non_proxied_udp"],
    timeout: 10_000,
  });
  const stop = () => { void close_quickly(browser.close()); };
  signal.addEventListener("abort", stop, { once: true });
  try {
    signal.throwIfAborted();
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: "block", acceptDownloads: false });
    await context.routeWebSocket("**/*", socket => { void socket.close(); });
    const page = await context.newPage();
    context.on("page", opened => { if (opened !== page) void opened.close().catch(() => {}); });
    page.on("dialog", dialog => { void dialog.dismiss().catch(() => {}); });
    const read = async (url: URL, limit: number) => transport.read(url, addresses[0], limit,
      AbortSignal.any([signal, AbortSignal.timeout(5_000)]));
    const read_document = async (value: string) => {
      let candidate = value;
      for (let hops = 0; hops <= 3; hops++) {
        const approved = site_navigation(root, candidate);
        if ("wall" in approved) throw new SiteWall(approved.wall);
        const response = await read(approved.url, max_document_bytes);
        if (redirect.has(response.status)) {
          if (!response.location) throw new SiteWall("unavailable");
          candidate = new URL(response.location, approved.url).href;
          continue;
        }
        if ([401, 403].includes(response.status)) throw new SiteWall("needs_account");
        if (response.status === 404 || response.status === 410) throw new SiteWall("dead_end");
        if (response.status < 200 || response.status >= 300 || !/^(?:text\/html|application\/xhtml\+xml)(?:;|$)/iu.test(response.content_type)) {
          throw new SiteWall("unavailable");
        }
        return { ...response, url: approved.url.href };
      }
      throw new SiteWall("unavailable");
    };
    let document_response: Awaited<ReturnType<typeof read_document>> | undefined;
    let remaining_bytes = max_asset_bytes;
    let asset_count = 0;
    const handles = new Map<string, ElementHandle>();
    const clear_handles = async () => {
      const previous = [...handles.values()];
      handles.clear();
      await Promise.allSettled(previous.map(handle => handle.dispose()));
    };
    await context.route("**/*", async route => {
      try {
        const request = route.request();
        if (signal.aborted || request.method() !== "GET") { await route.abort(); return; }
        if (request.isNavigationRequest()) {
          const next = document_response;
          if (!next || request.url() !== next.url || request.frame() !== page.mainFrame()) { await route.abort(); return; }
          document_response = undefined;
          await route.fulfill({ status: next.status, body: next.body, headers: {
            "content-type": next.content_type, "content-security-policy": [next.content_security_policy, page_csp].filter(Boolean).join(", "),
          } });
          return;
        }
        const original = next_image_original(root, new URL(request.url()), request.resourceType());
        const approved = site_navigation(root, original?.href ?? request.url(), true);
        if ("wall" in approved || !resources.has(request.resourceType()) || remaining_bytes <= 0 || asset_count >= 50) { await route.abort(); return; }
        asset_count++;
        const limit = Math.min(remaining_bytes, max_document_bytes);
        remaining_bytes -= limit;
        const asset = await read(approved.url, limit);
        remaining_bytes += Math.max(0, limit - asset.body.length);
        if (asset.status < 200 || asset.status >= 300 ||
          (original && !/^image\/(?:avif|gif|jpeg|png|webp)(?:;|$)/iu.test(asset.content_type))) { await route.abort(); return; }
        await route.fulfill({ status: asset.status, body: asset.body, contentType: asset.content_type });
      } catch { await route.abort().catch(() => {}); }
    });
    return {
      open: async url => {
        await clear_handles();
        document_response = await read_document(url);
        asset_count = 0;
        remaining_bytes = max_asset_bytes;
        await page.goto(document_response.url, { waitUntil: "domcontentloaded", timeout: 6_000 });
        await page.locator("body").waitFor({ state: "visible", timeout: 3_000 });
      },
      observe: async () => {
        await clear_handles();
        // Retain handles to the observed elements even if a page later rearranges its DOM.
        const ranked = await page.evaluateHandle(({ selector, goal }) => {
          const { document } = globalThis as typeof globalThis & { document: TBrowserDocument };
          const words = (value: string) => value.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [];
          const terms = new Set(words(goal));
          return [...document.querySelectorAll(selector)].filter(node => node.checkVisibility({ opacityProperty: true, visibilityProperty: true }))
            .map((node, index) => {
              const name = node.getAttribute("aria-label") || node.innerText || node.title || "";
              const matches = [...new Set(words(name))].filter(word => terms.has(word)).length;
              return { node, index, priority: matches * 4 + Number(!!node.closest("main,article,[role=main]")) };
            }).sort((a, b) => b.priority - a.priority || a.index - b.index).slice(0, 120).map(item => item.node);
        }, { selector: interactive, goal });
        const candidates = [...(await ranked.getProperties()).values()].flatMap(property => {
          const node = property.asElement();
          return node ? [node] : [];
        });
        await ranked.dispose();
        const elements = (await Promise.all(candidates.map(async (handle, index) => {
          const result = await handle.evaluate(raw => {
            const node = raw as unknown as TBrowserControl;
            if (!node.checkVisibility?.({ opacityProperty: true, visibilityProperty: true })) return undefined;
            const tag = node.tagName.toLowerCase();
            // Mail links provide contact evidence. They are never executable browser actions.
            if (tag === "a" && /^mailto:/iu.test(node.href ?? "")) return undefined;
            const role = tag === "a" ? "link" : tag === "select" ? "combobox" :
              tag === "button" && node.form && node.type === "submit" ? "submit" : node.getAttribute("role") ?? "button";
            const { document } = globalThis as typeof globalThis & { document: TBrowserDocument };
            const labelled = node.getAttribute("aria-labelledby")?.split(/\s+/u).map(id => document.getElementById(id)?.textContent ?? "").join(" ");
            const name = (node.getAttribute("aria-label") || labelled || (tag === "select" ? node.labels?.[0]?.textContent : node.innerText) ||
              node.title || "").replace(/\s+/gu, " ").trim().slice(0, 140);
            if (!name) return undefined;
            const enabled = !node.matches(":disabled,[aria-disabled=true]");
            const options = tag === "select" && node.options ? [...node.options].filter(option => !option.disabled)
              .map(option => option.label.slice(0, 120)).slice(0, 16) : undefined;
            return { role, name, enabled, ...(tag === "a" && node.href && { href: node.href.slice(0, 2048) }), ...(options && { options }) };
          }).catch(() => undefined);
          if (!result) { await handle.dispose(); return undefined; }
          const ref = "e" + (index + 1);
          handles.set(ref, handle);
          return { ref, ...result };
        }))).filter((candidate): candidate is TSiteElement => !!candidate);
        const content = await page.evaluate(include_contact => {
          const { document, innerHeight, innerWidth } = globalThis as typeof globalThis & { document: TBrowserDocument; innerHeight: number; innerWidth: number };
          const clean = (value: string) => value.replace(/\s+/gu, " ").trim();
          const main = document.querySelector("main,[role=main],article") ?? document.body;
          const visible = (node: TBrowserControl) => {
            const box = node.getBoundingClientRect();
            return box.bottom > 0 && box.top < innerHeight && box.width > 0 && node.checkVisibility({ opacityProperty: true, visibilityProperty: true });
          };
          const excerpt = (node: TBrowserControl) => {
            const text = clean(node.innerText ?? "");
            if (text.length <= 320) return text;
            const taken = text.slice(0, 320);
            const complete = taken.match(/^.*[.!?。！？](?=\s)/u)?.[0];
            return complete && complete.length >= 60 ? complete : taken.replace(/\s+\S*$/u, "") + "…";
          };
          const rendered = (node: TBrowserControl) => node.checkVisibility({ opacityProperty: true, visibilityProperty: true });
          const visible_nodes = [...main.querySelectorAll("h1,h2,h3,p,li,dd,blockquote,figcaption,pre")]
            .filter(node => visible(node) && !node.closest("header,nav,footer,form,[aria-hidden=true]"));
          const code_facts: string[] = [];
          const prose: string[] = [];
          for (const [index, node] of visible_nodes.entries()) {
            const text = excerpt(node);
            if (text.length < 4) continue;
            if (node.tagName.toLowerCase() !== "pre") { prose.push(text); continue; }
            // Keep a visible instruction next to its command when the preceding paragraph introduces the example.
            const previous = visible_nodes[index - 1];
            const lead = previous?.tagName.toLowerCase() === "p" ? excerpt(previous) : "";
            code_facts.push(lead.length < 140 && /[:：]$/u.test(lead) ? lead + " " + text : text);
          }
          const contacts = new Map<string, string>();
          if (include_contact) {
            for (const link of document.querySelectorAll('a[href^="mailto:" i]')) {
              const label = clean(link.innerText ?? "");
              if (!label || label.length > 80 || !visible(link) || link.closest('form,[aria-hidden=true],[inert]')) continue;
              const box = link.getBoundingClientRect();
              const x = (Math.max(0, box.left) + Math.min(innerWidth, box.right)) / 2;
              const y = (Math.max(0, box.top) + Math.min(innerHeight, box.bottom)) / 2;
              if (box.height <= 0 || document.elementFromPoint(x, y)?.closest("a[href]") !== link) continue;
              const href = link.getAttribute("href") ?? "";
              const match = /^mailto:([a-z0-9][a-z0-9._+-]{0,63})@((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63})$/i.exec(href);
              if (!match || href.length > 261 || match[1].includes("..") || match[1].endsWith(".") ||
                /\.(?:localhost|local|internal|test|invalid)$/iu.test(match[2])) continue;
              const address = match[1] + "@" + match[2];
              if (!contacts.has(address)) contacts.set(address, `Contact link “${label}” points to ${address}.`);
              if (contacts.size === 2) break;
            }
          }
          const facts = [...new Set([...contacts.values(), ...code_facts.slice(0, 6), ...prose])].slice(0, 12);
          return { code_facts, title: clean(document.title || facts[0] || "").slice(0, 160), facts,
            password_field: [...document.querySelectorAll("input[type=password]")].some(rendered),
            payment_field: [...document.querySelectorAll('input[autocomplete^="cc-"],input[name*="cardnumber" i],input[name="cvc" i]')].some(rendered),
            challenge: !!document.querySelector('iframe[src*="recaptcha" i],iframe[src*="hcaptcha" i],iframe[src*="turnstile" i],.cf-turnstile,.g-recaptcha,.h-captcha') ||
              /verify (?:that )?you are human|checking your browser/iu.test(document.body?.innerText?.slice(0, 2400) ?? ""),
          };
        }, /contact|e-?mail|reach|(?:get|keep) in touch|संपर्क|सम्पर्क|ईमेल/iu.test(goal));
        const samples = await page.locator("main pre,article pre,[role=main] pre").elementHandles();
        const examples = [];
        for (const [index, sample] of samples.entries()) {
          if (index >= 100 || !await sample.isVisible()) { await sample.dispose(); continue; }
          const text = (await sample.innerText()).replace(/\s+/gu, " ").trim().slice(0, 320);
          const ref = "x" + (index + 1);
          handles.set(ref, sample);
          examples.push({ ref, text });
        }
        const screenshot = await page.screenshot({ type: "jpeg", quality: 74, animations: "disabled", timeout: 4_000,
          mask: [page.locator(visual_private_fields)] });
        return { ...content, url: page.url(), elements, examples, screenshot };
      },
      click: async ref => {
        const handle = handles.get(ref);
        if (!handle) throw new SiteWall("unavailable");
        await handle.click({ timeout: 1_500 });
      },
      select: async (ref, option) => {
        const handle = handles.get(ref);
        if (!handle) throw new SiteWall("unavailable");
        await handle.selectOption({ label: option }, { timeout: 1_500 });
      },
      show_example: async ref => {
        const sample = handles.get(ref);
        if (!sample) throw new SiteWall("unavailable");
        await sample.scrollIntoViewIfNeeded({ timeout: 1_500 });
      },
      scroll: async direction => {
        await page.evaluate(value => (globalThis as typeof globalThis & { scrollBy: (x: number, y: number) => void }).scrollBy(0, value),
          direction === "up" ? -640 : 640);
      },
      close: async () => { signal.removeEventListener("abort", stop); await close_quickly(browser.close()); },
    };
  } catch (error) {
    signal.removeEventListener("abort", stop);
    await close_quickly(browser.close());
    throw error;
  }
};
