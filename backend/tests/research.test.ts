import { api_error } from "../src/middleware/api-error";
import { create_api } from "../src/app";
import { serve_api } from "./helpers/serve-api";
import { describe, expect, test } from "bun:test";
import { research_handlers } from "../src/controllers/research";
import { create_session } from "../src/controllers/session";
import { build_research } from "../src/services/research";
import type { TResearchBrief, TResearchProvider } from "../src/types/research";

const brief: TResearchBrief = {
  brief_id: crypto.randomUUID(), messages: ["Compare the pilot results"], summary: "Prepare a pilot summary",
  source_policy: "files_only", urls: ["https://example.org/study"], public_queries: ["pilot study"],
  materials: "The January pilot enrolled 42 people.", question: null,
};

const fixture_provider = (): TResearchProvider => {
  return {
    clarify: async scope => ({
      summary: scope.messages.join(" "), question: scope.messages.length === 1 ? "Who will decide?" : null,
      public_queries: ["published pilot measurements"],
    }),
    lookup: async () => { throw new Error("Unexpected network lookup"); },
    verify: async review => review.units.map(unit => ({ id: unit.id, decision: "supported" })),
    draft: async () => ({
      title: "Pilot findings", gaps: ["Long-term retention remains unknown."],
      sections: [{ heading: "January enrollment", paragraphs: [
        { prose: "The pilot enrolled 42 people.", support: [{ evidence_id: "M1", excerpt: "enrolled 42 people" }] },
        { prose: "Unsupported number 950.", support: [{ evidence_id: "M1", excerpt: "950" }] },
      ] }],
    }),
  };
};

test("files-only report retains verbatim evidence and identifies invalid citations and unopened URLs", async () => {
  let lookups = 0;
  const provider = fixture_provider();
  provider.lookup = async () => { lookups++; return []; };
  const result = await build_research(brief, provider, new AbortController().signal, () => {});
  expect(lookups).toBe(0);
  expect(result.markdown).toContain("42 people. [^M1]");
  expect(result.markdown).toContain("“enrolled 42 people”");
  expect(result.markdown).not.toContain("950");
  expect(result.findings.sections[0].paragraphs).toEqual([{ prose: "The pilot enrolled 42 people.",
    support: [{ evidence_id: "M1", excerpt: "enrolled 42 people" }] }]);
  expect(result.confirmed_brief.materials).toBe(brief.materials);
  expect(result.gaps.join(" ")).toContain("withheld");
  expect(result.gaps.join(" ")).toContain(brief.urls[0]);
});

test("explicit pages with only a different URL in search results stay unresolved", async () => {
  const queries: string[] = [];
  const provider = fixture_provider();
  provider.lookup = async (query,url) => {
    queries.push(JSON.stringify({ query,url }));
    return [{ passage: "Public finding", url: "https://example.org/another", title: "Other" }];
  };
  const result = await build_research({ ...brief, source_policy: "public_search" }, provider, new AbortController().signal, () => {});
  expect(queries).toHaveLength(2);
  expect(queries.join(" ")).not.toContain("42 people");
  expect(queries.join(" ")).not.toContain(brief.messages[0]);
  expect(result.gaps.join(" ")).toContain("No citation-backed result for " + brief.urls[0]);
  expect(result.evidence.filter(item => item.origin === "public")).toHaveLength(1);
});

describe("authenticated research routes", () => {
  test("clarification, explicit confirmation, versioning, cached duplicate builds, private export", async () => {
    process.env.AI_SESSION_DB = ":memory:";
    const provider = fixture_provider();
    const handlers = research_handlers(() => provider);
    const app = create_api();
    app.post("/sessions", create_session);
    app.post("/:session_id/brief", handlers.review);
    app.post("/:session_id/build", handlers.build);
    app.get("/:session_id/:research_id/export", handlers.download);
    app.use(api_error);
    await using http = await serve_api(app);
    const host = await (await http.request("/sessions", { method: "POST" })).json();
    const auth = { Authorization: "Bearer " + host.token, "Content-Type": "application/json" };
    const post = (path: string, body: unknown) => http.request("/" + host.session_id + "/" + path, {
      method: "POST", headers: auth, body: JSON.stringify(body),
    });
    const initial = await (await post("brief", { message: "Summarize the pilot", source_policy: "files_only", materials: brief.materials })).json();
    expect(initial.question).toBe("Who will decide?");
    expect(initial.public_queries).toEqual([]);
    expect((await post("build", { brief_id: initial.brief_id, confirmed: true })).status).toBe(409);
    const reviewed = await (await post("brief", { brief_id: initial.brief_id, message: "The operations lead.",
      source_policy: "files_only" })).json();
    expect(reviewed.question).toBeNull();
    expect((await post("build", { brief_id: initial.brief_id, confirmed: true })).status).toBe(409);
    expect((await post("build", { brief_id: reviewed.brief_id, confirmed: false })).status).toBe(400);
    const build = () => post("build", { brief_id: reviewed.brief_id, confirmed: true }).then(res => res.json());
    const [first, second] = await Promise.all([build(), build()]);
    expect(first.research_id).toBeTruthy();
    expect(second.research_id).toBe(first.research_id);
    const path = "/" + host.session_id + "/" + first.research_id + "/export";
    expect((await http.request(path)).status).toBe(401);
    const exported = await http.request(path, { headers: auth });
    expect(exported.headers.get("Content-Disposition")).toContain("presentation.md");
    expect(await exported.text()).toBe(first.markdown);
  });
});
