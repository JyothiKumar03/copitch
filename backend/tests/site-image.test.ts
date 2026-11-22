import { expect, test } from "bun:test";
import { open_site_browser } from "../src/services/site-browser";

test("Next image views render the approved pinned public raster original with no optimizer requests", async () => {
  const root = new URL("https://portfolio.example.com/");
  const requests: string[] = [];
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aKi8AAAAASUVORK5CYII=", "base64");
  const placeholder = (query: string) => '<img src="/_next/image?' + query + '">';
  const body = Buffer.from('<main><h1 id="status">Waiting for portrait</h1>' +
    '<img src="/_next/image?url=%2Fimages%2Fportrait.png&amp;w=640&amp;q=75" onload="document.getElementById(\'status\').textContent=\'Public portrait loaded\'">' +
    ["/images/duplicate.png", "/images/unknown.png", "/images/nested.png?size=1", "/images/fragment.png#view", "/images/private/photo.png",
      "/images/session/photo.png", "/images/page.html", "//elsewhere.example.com/photo.png", "https://elsewhere.example.com/photo.png",
      "/images/%2Fphoto.png"].map((url, index) => placeholder("url=" + encodeURIComponent(url) +
        (index === 0 ? "&amp;url=%2Fimages%2Fsecond.png" : index === 1 ? "&amp;other=1" : ""))).join("") + "</main>");
  const browser = await open_site_browser(root, AbortSignal.timeout(10_000), {
    resolve: async () => ["93.184.215.14"],
    read: async (url, pin) => {
      expect(pin).toBe("93.184.215.14");
      requests.push(url.href);
      return { url: url.href, status: 200, content_type: url.pathname === "/" ? "text/html" : "image/png", body: url.pathname === "/" ? body : png };
    },
  });
  try {
    await browser.open(root.href);
    let observation = await browser.observe();
    if (!observation.facts.includes("Public portrait loaded")) observation = await browser.observe();
    expect(observation.facts).toContain("Public portrait loaded");
    expect(requests).toEqual([root.href, new URL("/images/portrait.png", root).href]);
  } finally { await browser.close(); }
}, 15_000);
