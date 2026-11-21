import { expect, test } from "bun:test";
import { read_host_page } from "../src/services/host-pages";
import { create_research_sources } from "../src/services/research-tools";

const approved = { source_policy: "public_search" as const, urls: ["https://example.org/"], public_queries: ["Public pilot outcomes"] };

test("a host root exposes labeled pages and PDFs on the same site without reading them", async () => {
  const requests: string[] = [];
  const page = await read_host_page(approved.urls[0], AbortSignal.timeout(1000), { try_www: true, download: async url => {
    requests.push(url.href);
    return { html: `<html><head><title>Team &amp; Work</title></head><body>
      <p>We built a pilot for twelve teams.</p><script>Ignored text</script>
      <a href="/work">Selected work</a><a href="/resume.pdf">Résumé</a>
      <a href="/work#details">Duplicate</a><a href="https://other.org/jobs">Other site</a>
      <a href="https://www.example.org:8443/admin">Other port</a>
      <p>${"More about our pilot. ".repeat(10)} &#1114112;</p></body></html>` };
  } });
  expect(requests).toEqual(["https://www.example.org/"]);
  expect(page.hits[0]).toMatchObject({ url: requests[0], title: "Team & Work" });
  expect(page.hits[0].passage).toContain("We built a pilot for twelve teams.");
  expect(page.hits[0].passage).not.toContain("Ignored text");
  expect(page.links).toEqual([
    { url: "https://www.example.org/work", label: "Selected work", kind: "page" },
    { url: "https://www.example.org/resume.pdf", label: "Résumé", kind: "pdf" },
  ]);
});

test("page reads separate adjacent labels and exclude decorative and hidden text", async () => {
  const page = await read_host_page(approved.urls[0], AbortSignal.timeout(1000), {
    download: async () => ({ html: `<html><body>
      <a href="/work"><span aria-hidden="true">D</span><span>Draft Studio</span><span>Creates reviewed briefs.</span></a>
      <div hidden><a href="/internal">Internal-only link</a><p>Unpublished copy</p></div>
      <img aria-hidden="true" src="decoration.jpg"><p>Visible context after a decorative image.</p>
    </body></html>` }),
  });
  expect(page.links).toEqual([{ url: "https://example.org/work", label: "Draft Studio Creates reviewed briefs.", kind: "page" }]);
  const passage = page.hits[0].passage;
  expect(passage).toContain("Draft Studio Creates reviewed briefs.");
  expect(passage).not.toContain("DDraft");
  expect(passage).not.toContain("Unpublished copy");
  expect(passage).toContain("Visible context after a decorative image.");
});

test("a discovered PDF saves verbatim passages with the public URL and page location", async () => {
  const fixture = Bun.file(new URL("./fixtures/sources/Pilot brief.pdf", import.meta.url));
  const url = "https://example.org/brief.pdf";
  const result = await read_host_page(url, AbortSignal.timeout(5000), {
    download: async () => ({ pdf: Buffer.from(await fixture.arrayBuffer()) }),
  });
  expect(result.links).toEqual([]);
  expect(result.hits.find(hit => hit.title === "brief.pdf, page 2")).toMatchObject({ url });
  expect(result.hits.find(hit => hit.title === "brief.pdf, page 2")?.passage).toContain("The trial was observational and lacked a comparison group.");
});

test("an approved text source returns quotable text under its own URL", async () => {
  const url = "https://example.org/llms.txt";
  const text = "# Profile\n\nThe project served 500+ people.\nIt was part of the public pilot.";
  const result = await read_host_page(url, AbortSignal.timeout(1000), { download: async () => ({ text }) });
  expect(result).toEqual({ url, links: [], hits: [{ url, title: "llms.txt", passage: text }] });
});

test("a page redirect cannot expand the approved site", async () => {
  const requests: string[] = [];
  await expect(read_host_page(approved.urls[0], AbortSignal.timeout(1000), { download: async url => {
    requests.push(url.href);
    return { redirect: "https://other.org/away" };
  } })).rejects.toThrow("outside the approved site");
  expect(requests).toEqual(approved.urls);
});

test("the source tools enforce the source policy and turn hosted results into links only", async () => {
  const queries: string[] = [];
  const requests: string[] = [];
  const lookup = async (query: string) => {
    queries.push(query);
    return [
      { url: "https://public.example/pilot", title: "Pilot", passage: "Generated summary" },
      { url: "https://public.example/pilot#same", title: "Duplicate", passage: "Generated summary" },
      { url: "http://127.0.0.1/private", title: "Disallowed host", passage: "Generated summary" },
    ];
  };
  const read = async (url: string) => {
    requests.push(url);
    return { url, hits: [], links: [] };
  };
  const signal = AbortSignal.timeout(1000);
  const tools = create_research_sources(approved, lookup, read);
  const files_only = create_research_sources({ ...approved, source_policy: "files_only" }, lookup, read);
  await expect(files_only.read_page(approved.urls[0], [], signal)).rejects.toThrow("Files-only");
  await expect(files_only.search_web(approved.public_queries[0], signal)).rejects.toThrow("Files-only");
  await expect(tools.search_web("  a ", signal)).rejects.toThrow("Write a search query");
  await expect(tools.read_page("https://example.org/unseen", [], signal)).rejects.toThrow("host-approved page");
  const links = await tools.search_web(approved.public_queries[0], signal);
  expect(links).toEqual([{ url: "https://public.example/pilot", label: "Pilot", kind: "page" }]);
  await tools.read_page(approved.urls[0], [], signal);
  await tools.read_page(links[0].url, links.map(link => link.url), signal);
  expect(queries).toEqual(approved.public_queries);
  expect(requests).toEqual([approved.urls[0], links[0].url]);
});

test("the public dispatch blocks private note identifiers and upload excerpts while permitting public queries", async () => {
  const queries: string[] = [];
  const signal = AbortSignal.timeout(1000);
  const public_query = "national collaboration pilot results from government statistics";
  const tools = create_research_sources({ ...approved, public_queries: [public_query],
    studio_notes: ["The synthetic case is synthetic-company-private-internal-id."],
    history: [{ role: "host", text: "Follow up with presenter@example.invalid privately." }],
  }, async query => { queries.push(query); return []; }, undefined, [{
    id: "M1", origin: "material", location: "Notes.pdf",
    passage: "The national collaboration pilot results from government statistics accompany the confidential board voted to postpone strategy.",
  }]);
  await expect(tools.search_web("public collaboration research SYNTHETIC-COMPANY-PRIVATE-INTERNAL-ID", signal)).rejects.toThrow("private notes or identifiers");
  await expect(tools.search_web("pilot presenter@example.invalid contact", signal)).rejects.toThrow("private notes or identifiers");
  await expect(tools.search_web("why the confidential board voted to postpone strategy", signal)).rejects.toThrow("private notes or identifiers");
  expect(queries).toEqual([]);
  await tools.search_web(`site:example.org ${public_query}`, signal);
  await tools.search_web("official national public sector collaboration pilot benchmarks", signal);
  expect(queries).toEqual([`site:example.org ${public_query}`, "official national public sector collaboration pilot benchmarks"]);
});
