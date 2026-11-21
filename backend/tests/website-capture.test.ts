import { expect, test } from "bun:test";
import { capture_website, website_capture_url } from "../src/services/website-capture";
import type { TWebsiteCaptureAttempt, TWebsiteCaptureServices } from "../src/services/website-capture";

const ipv4 = "93.184.215.14";
const host = "walkthrough.example.com";

test("capture URL refuses local, credentialed and nonstandard-port destinations", () => {
  for (const blocked of ["http://localhost", "http://127.1/", "http://10.0.0.2", "http://[::1]", "http://team.local.",
    "https://project.internal/", "ftp://www.example.com/", "https://user:secret@www.example.com/",
    "https://www.example.com:8443/", "https://www.example.com/?%61ccess_token=secret", "https://www.example.com/?sessionId=secret"]) {
    expect(website_capture_url(blocked)).toBeUndefined();
  }
  expect(website_capture_url("https://www.example.com:443/guide?v=2#intro")?.href).toBe("https://www.example.com/guide?v=2");
});

test("private and mixed public/private DNS answers prevent the browser and transport from starting", async () => {
  let launches = 0;
  let reads = 0;
  for (const addresses of [["127.0.0.1"], [ipv4, "169.254.169.254"], ["192.0.2.10"], ["100.64.1.1"], []]) {
    const result = await capture_website("https://" + host, AbortSignal.timeout(1000), undefined, {
      resolve: async () => addresses,
      read: async () => { reads++; throw new Error("Unexpected fetch"); },
      launch: async () => { launches++; throw new Error("Unexpected browser launch"); },
    });
    expect(result.pages).toEqual([]);
    expect(result.attempts).toEqual([{ url: "https://" + host + "/", status: "failed", depth: 0,
      reason: "The approved host does not resolve exclusively to a public IPv4 address." }]);
  }
  expect({ launches, reads }).toEqual({ launches: 0, reads: 0 });
});

test("capture reuses one pinned public address across approved pages, assets and redirects while preserving failures", async () => {
  const start = "http://" + host + "/";
  const origin = "https://" + host;
  const calls: string[] = [];
  const attempts: TWebsiteCaptureAttempt[] = [];
  let resolved = 0;
  let closed = 0;
  const services: TWebsiteCaptureServices = {
    resolve: async hostname => { expect(hostname).toBe(host); resolved++; return [ipv4]; },
    read: async (url, pin) => {
      expect(pin).toBe(ipv4);
      calls.push(url.href);
      const redirects: Record<string, string> = {
        [start]: origin + "/home",
        [origin + "/outside"]: "https://other.example.com/",
        [origin + "/credential"]: "/help?token=never",
        [origin + "/downgrade"]: start,
        [origin + "/asset.css"]: "/logout",
      };
      const location = redirects[url.href];
      return { url: url.href, status: location ? 302 : url.pathname === "/missing" ? 404 : 200,
        content_type: url.pathname.endsWith(".css") ? "text/css" : "text/html; charset=utf-8",
        location, body: Buffer.from("Fixture") };
    },
    launch: async () => ({
      close: async () => { closed++; },
      capture: async (document, asset) => {
        if (document.url === origin + "/home") {
          await expect(asset(origin + "/style.css?v=8")).resolves.toMatchObject({ status: 200 });
          await expect(asset("https://other.example.com/style.css")).rejects.toThrow("outside the approved page");
          await expect(asset(origin + "/asset.css")).rejects.toThrow("account, action");
          await expect(asset(origin + "/logout")).rejects.toThrow("account, action");
        }
        return { url: document.url, title: "Observed fixture", facts: ["An observed fact."], screenshot: Buffer.from("fixture picture"),
          links: document.url === origin + "/home" ? [origin + "/features", origin + "/missing", origin + "/outside",
            origin + "/credential", origin + "/downgrade", origin + "/account/logout", origin + "/help?session=deny",
            "https://other.example.com/about", origin + "/features#duplicate"] : [] };
      },
    }),
  };
  const result = await capture_website(start, AbortSignal.timeout(1000), attempt => attempts.push(attempt), services);
  expect(result.pages.map(page => page.url)).toEqual([origin + "/home", origin + "/features"]);
  expect(result.attempts).toEqual(attempts);
  expect(attempts.map(attempt => [attempt.status, new URL(attempt.url).pathname])).toEqual([
    ["captured", "/"], ["captured", "/features"], ["failed", "/missing"],
    ["failed", "/outside"], ["failed", "/credential"], ["failed", "/downgrade"],
  ]);
  expect(attempts.slice(-3).every(attempt => attempt.reason?.includes("outside the approved website"))).toBe(true);
  expect(calls).toEqual([start, origin + "/home", origin + "/style.css?v=8", origin + "/asset.css", origin + "/features",
    origin + "/missing", origin + "/outside", origin + "/credential", origin + "/downgrade"]);
  expect({ resolved, closed }).toEqual({ resolved: 1, closed: 1 });
});

test("approved crawl depth is measured by link hops and checks relevant routes first without reaching deeper pages", async () => {
  const origin = "https://" + host;
  const children: Record<string, string[]> = {
    "/": ["/about", "/pricing"], "/pricing": ["/pricing/enterprise"], "/pricing/enterprise": ["/pricing/enterprise/faq"],
  };
  for (const max_depth of [0, 1, 2]) {
    const visited: string[] = [];
    const result = await capture_website(origin, AbortSignal.timeout(1000), undefined, {
      resolve: async () => [ipv4],
      read: async url => {
        visited.push(url.pathname);
        return { url: url.href, status: 200, content_type: "text/html", body: Buffer.from("fixture") };
      },
      launch: async () => ({
        close: async () => {},
        capture: async document => ({
          url: document.url, title: "Fixture", facts: ["A visible fact."], screenshot: Buffer.from("image"),
          links: (children[new URL(document.url).pathname] ?? []).map(path => origin + path),
        }),
      }),
    }, { max_depth, goal: "Show pricing for an enterprise audience" });
    const paths = max_depth === 0 ? ["/"] : max_depth === 1 ? ["/", "/pricing", "/about"] : ["/", "/pricing", "/about", "/pricing/enterprise"];
    expect(visited).toEqual(paths);
    expect(result.pages.map(({ depth }) => depth)).toEqual([0, 1, 1, 2].slice(0, paths.length));
    expect(result.attempts.map(({ depth }) => depth)).toEqual(result.pages.map(({ depth }) => depth));
  }
});
