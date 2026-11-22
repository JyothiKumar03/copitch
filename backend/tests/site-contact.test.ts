import { expect, test } from "bun:test";
import { open_site_browser } from "../src/services/site-browser";

test("a contact goal records only a visibly labelled plain recipient and offers no mail actions", async () => {
  const root = new URL("https://portfolio.example.com/");
  const body = Buffer.from(`<!doctype html><main><h1>Portfolio</h1>
    <a href="/projects">Projects</a>
    <a href="mailto:hello@example.com"><span>Email me</span></a>
    <a href="mailto:hello@example.com">Ask me about it</a>
    <a href="mailto:prefill@example.com?subject=Hello&amp;body=private">Prefilled</a>
    <a href="mailto:first@example.com,second@example.com">Group</a>
    <a href="mailto:person@office.internal">Internal</a>
    <a href="mailto:encoded%0a@example.com">Encoded</a>
    <a href="mailto:invisible@example.com" aria-hidden="true">Hidden</a>
    <a href="mailto:icon@example.com" aria-label="Icon"><span></span></a>
    <a style="position:absolute;top:2000px" href="mailto:below@example.com">Below</a>
    </main>`);
  for (const [goal, expected] of [
    ["How can I contact the presenter?", ["Contact link “Email me” points to hello@example.com."]],
    ["Show projects", []],
  ] as const) {
    const requests: string[] = [];
    const browser = await open_site_browser(root, AbortSignal.timeout(10_000), {
      resolve: async () => ["93.184.215.14"],
      read: async url => {
        requests.push(url.href);
        return { url: url.href, content_type: "text/html", status: 200, body };
      },
    }, goal);
    try {
      await browser.open(root.href);
      const observation = await browser.observe();
      expect(observation.facts.filter(fact => fact.includes("@"))).toEqual([...expected]);
      expect(observation.elements.map(element => element.name)).toEqual(["Projects"]);
      expect(observation.screenshot.readUInt16BE()).toBe(0xffd8);
      expect(requests).toEqual([root.href]);
    } finally { await browser.close(); }
  }
}, 25_000);
