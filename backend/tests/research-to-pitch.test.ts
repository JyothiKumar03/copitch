import { api_error } from "../src/middleware/api-error";
import { serve_api } from "./helpers/serve-api";
import { test, expect } from "bun:test";
import app, { create_api } from "../src/app";
import { research_handlers } from "../src/controllers/research";
import { database } from "../src/repositories/store";
import type { TResearchBundle, TResearchProvider } from "../src/types/research";

test("a confirmed buyer brief becomes one persisted, traceable deck through HTTP", async () => {
  process.env.AI_SESSION_DB = ":memory:";
  let drafts = 0;
  let searches = 0;
  let reviewed_pitch_units = 0;
  const handlers = research_handlers((): TResearchProvider => ({
    clarify: async scope => ({ summary: scope.messages.join(" "), question: null, public_queries: [] }),
    lookup: async () => { searches++; return []; },
    verify: async review => {
      reviewed_pitch_units += review.units.filter(unit => unit.id.startsWith("pitch-")).length;
      return review.units.map(unit => ({ id: unit.id, decision: "supported" }));
    },
    draft: async () => {
      drafts++;
      return { title: "Enterprise onboarding pilot", gaps: ["No causal study"], pitch_script: [
        { purpose: "opening", prose: "Let’s look at the enterprise pilot.", support: [{ evidence_id: "H1", excerpt: "enterprise buyer" }] },
        { purpose: "point", prose: "Four of twenty enterprise trials converted.", support: [{ evidence_id: "M1", excerpt: "4 of 20 enterprise" }] },
        { purpose: "close", prose: "Let’s discuss a pilot for your team.", support: [{ evidence_id: "H1", excerpt: "pilot pitch" }] },
      ], sections: [
        { heading: "Enterprise conversion", paragraphs: [
          { prose: "Four of twenty enterprise trials converted. This is a small cohort.", support: [{ evidence_id: "M1", excerpt: "4 of 20 enterprise" }] },
          { prose: "Setup is twice as fast.", support: [{ evidence_id: "M1", excerpt: "twice as fast" }] },
        ] },
      ] };
    },
  }));
  const fixture = create_api();
  // Replace only the model-facing request handlers. Mount the production app for other endpoints.
  fixture.post("/api/sessions/:session_id/research/brief", handlers.review);
  fixture.post("/api/sessions/:session_id/research", handlers.build);
  fixture.use(app);
  fixture.use(api_error);
  await using http = await serve_api(fixture);
  const host = await (await http.request("/api/sessions", { method: "POST" })).json();
  const path = "/api/sessions/" + host.session_id;
  const auth = { Authorization: "Bearer " + host.token, "Content-Type": "application/json" };
  const post = (route: string, body: unknown) => http.request(path + route, { method: "POST", headers: auth, body: JSON.stringify(body) });
  const brief = await (await post("/research/brief", { message: "Prepare a five-minute pilot pitch for our enterprise buyer. Use only my results.",
    source_policy: "files_only", urls: ["https://example.org/pilot"], materials: "4 of 20 enterprise trials converted. Overall, 10 of 100 converted." })).json();
  expect((await post("/research", { brief_id: brief.brief_id, confirmed: false })).status).toBe(400);
  const build = async () => (await post("/research", { brief_id: brief.brief_id, confirmed: true })).json();
  const [one, two] = await Promise.all([build(), build()]);
  expect(one.research_id).toBe(two.research_id);
  expect(drafts).toBe(1);
  expect(searches).toBe(0);
  expect(one.markdown).toContain("No causal study");
  expect(one.gaps.join(" ")).toContain("unopened");
  const pitch_path = path + "/research/" + one.research_id + "/pitch";
  expect((await http.request(pitch_path)).status).toBe(401);
  const pitch = await (await http.request(pitch_path, { headers: auth })).json();
  expect(reviewed_pitch_units).toBe(3);
  expect(pitch.format).toBe("script");
  expect(pitch.passages.map((part: { label: string }) => part.label)).toEqual(["Opening", "Talking point", "Closing ask"]);
  expect(pitch.passages[1].evidence_ids).toEqual(["M1"]);
  const prepared = await post("/decks", { research_id: one.research_id });
  expect(prepared.status).toBe(201);
  const deck = await prepared.json();
  expect(deck.slides[0].evidence_ids).toEqual(["M1"]);
  expect(deck.slides[0].highlights).toEqual(["Four of twenty enterprise trials converted."]);
  expect(deck.slides[0].narration).toContain("small cohort");
  expect(JSON.stringify(deck)).not.toContain("twice as fast");
  const fresh = await http.request(path + "/decks/" + deck.deck_id + "?revision=1", { headers: auth });
  expect(await fresh.json()).toEqual(deck);
  expect((await (await post("/decks", { research_id: one.research_id })).json()).deck_id).toBe(deck.deck_id);

  const old_brief = await (await post("/research/brief", { message: "My second briefing.", source_policy: "files_only" })).json();
  const older = { research_id: crypto.randomUUID(), brief_id: old_brief.brief_id, markdown: "Original saved memo", evidence: [], gaps: [] };
  expect(database().save_research(host.session_id, older as TResearchBundle)).toBe(true);
  expect((await post("/decks", { research_id: older.research_id })).status).toBe(422);
  const old_memo = await http.request(path + "/research/" + older.research_id + "/presentation.md", { headers: auth });
  expect(await old_memo.text()).toBe(older.markdown);
});
