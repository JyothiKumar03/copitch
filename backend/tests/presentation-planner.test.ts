import { expect, test } from "bun:test";
import { createOpenAI } from "@ai-sdk/openai";
import { estimate_pitch_seconds, prepare_pitch } from "../src/services/pitch";
import { presentation_plan_provider, presentation_plan_review } from "../src/services/presentation-planner";
import { research_provider } from "../src/services/research-provider";
import { pitch_variant_key } from "../src/repositories/deck";
import { SessionStore } from "../src/repositories/session";
import type { TModelCandidate } from "../src/types/ai";
import type { TPitchInput } from "../src/types/deck";
import type { TResearchBundle } from "../src/types/research";

const results = "Alpha recorded 42 pilots.\nBeta recorded 51 pilots.";
const leadership = "Jordan led the onboarding team in 2025.";
const support = (evidence_id: string, excerpt: string) => [{ evidence_id, excerpt }];
const spoken = (text: string, ...evidence_ids: string[]) => ({ text, evidence_ids });
const verified = async () => true;
const config: TModelCandidate = { provider: "openai", model: "fake", max_output_tokens: 1024, tool_providers: [] };
const saved: TResearchBundle = {
  brief_id: "brief", research_id: "research", markdown: "Saved report", gaps: [],
  grounding: { version: 1, mode: "verified" },
  confirmed_brief: { brief_id: "brief", summary: "Introduce Jordan to the team.", question: null,
    source_policy: "public_search", urls: [], public_queries: [], messages: [], materials: "",
    intent: { subject: "Jordan", audience: "New team", outcome: "Know who led the pilots", deliverable: "Pitch and talk track" } },
  findings: { title: "Jordan's pilot work", sections: [
    { heading: "Pilot results", paragraphs: [{ prose: results, support: support("P1", results) }] },
    { heading: "Leadership", paragraphs: [{ prose: leadership, support: support("P2", leadership) }] },
  ] },
  evidence: [
    { id: "P1", origin: "public", location: "Pilot results", url: "https://portfolio.example/pilots", passage: results },
    { id: "P2", origin: "public", location: "Leadership", url: "https://portfolio.example/roles", passage: leadership },
  ],
  pitch_script: [
    { purpose: "opening", prose: "Thanks for meeting today.", support: [] },
    { purpose: "point", prose: "Alpha recorded 42 pilots. Beta recorded 51 pilots.", support: support("P1", results) },
    { purpose: "point", prose: leadership, support: support("P2", leadership) },
    { purpose: "close", prose: "Let's discuss what to try next.", support: [] },
  ],
};

test("production planner sends structured candidate text and a second call verifies it", async () => {
  const approved = { rationale: "Focus on pilots.", beats: [
    { title: "What Alpha delivered", highlights: ["Alpha recorded 42 pilots."], evidence_ids: ["P1"],
      sentences: [spoken("Here is what Alpha recorded: 42 pilots.", "P1")],
      template: { type: "metric_grid", metrics: [{ label: "Alpha", value: "42 pilots" }] } },
  ] };
  let calls = 0;
  const openai = createOpenAI({ apiKey: "fixture", fetch: async (_url, request) => {
    calls++;
    const wire = JSON.parse(request!.body as string);
    expect(wire.store).toBe(false);
    expect(wire.text.format.type).toBe("json_schema");
    const input = wire.input.find((turn: { role: string }) => turn.role === "user").content[0].text;
    const fields = wire.text.format.schema.properties;
    const output = fields.beats ? approved : { verdicts: JSON.parse(input).units.map((unit: { id: string }) =>
      ({ id: unit.id, decision: "supported", reason: null })) };
    if (fields.beats) {
      const template = fields.beats.items.properties.template;
      expect(template.anyOf).toHaveLength(9);
      expect(template.oneOf).toBeUndefined();
      expect(input).toContain(results.replaceAll("\n", "\\n"));
    } else {
      expect(input).toContain("What Alpha delivered");
      expect(input).toContain("Here is what Alpha recorded: 42 pilots.");
      expect(JSON.parse(input).evidence.map((record: { id: string }) => record.id)).toEqual(["P1"]);
    }
    return Response.json({ id: "fixture", model: "fake", status: "completed", created_at: 1,
      output: [{ type: "message", role: "assistant", id: "reply", status: "completed",
        content: [{ type: "output_text", text: JSON.stringify(output), annotations: [] }] }],
      usage: { input_tokens: 300, output_tokens: 90 },
    });
  } });
  const deck = await prepare_pitch(saved, { audience: "New team", duration_minutes: 1, slide_count: 1 },
    presentation_plan_provider(config, openai), presentation_plan_review(research_provider(config, openai, [])));
  expect(calls).toBe(2);
  expect(deck.slides[0].template).toEqual(approved.beats[0].template);
  expect(deck.pitch?.rationale).toBe(approved.rationale);
});

test("presentation planner adapts distinct visuals and natural narration to each audience", async () => {
  const team = await prepare_pitch(saved, { audience: "New team", duration_minutes: 1, slide_count: 2 }, async context => {
    expect(context.intent?.subject).toBe("Jordan");
    expect(context.audience).toBe("New team");
    expect(context.slide_count).toBe(2);
    expect(context.speaking_seconds).toBe(60);
    expect(context.findings.map(finding => finding.heading)).toEqual(["Pilot results", "Leadership"]);
    expect(context.evidence.map(record => record.id)).toEqual(["P1", "P2"]);
    return { rationale: "Use pilot results to introduce the work.", beats: [
      { title: "Compare the two pilots", highlights: ["Alpha recorded 42 pilots."], evidence_ids: ["P1"],
        sentences: [spoken("Let's start with the pilots."), spoken("Alpha recorded 42 pilots. Beta recorded 51.", "P1")],
        template: { type: "bar_chart", unit: "pilots", points: [{ label: "Alpha", value: 42 }, { label: "Beta", value: 51 }] } },
      { title: "Who led onboarding", highlights: [leadership], evidence_ids: ["P2"],
        sentences: [spoken("Jordan led onboarding in 2025.", "P2")],
        template: { type: "bullet_slide" } },
    ] };
  }, verified);
  const hiring = await prepare_pitch(saved, { audience: "Hiring manager", duration_minutes: 1, slide_count: 1 }, async context => {
    expect(context.audience).toBe("Hiring manager");
    return { rationale: "Lead with role and responsibility.", beats: [
      { title: "Jordan’s documented leadership", highlights: [leadership], evidence_ids: ["P2"],
        sentences: [spoken("The record shows Jordan led the onboarding team in 2025.", "P2"), spoken("We can discuss that role next.")],
        template: { type: "title_card" } },
    ] };
  }, verified);
  expect(team.slides[0].template).toMatchObject({ type: "bar_chart", points: [{ label: "Alpha", value: 42 }, { label: "Beta", value: 51 }] });
  expect(team.slides[0].evidence_ids).toEqual(["P1"]);
  expect(team.slides[0].beat_id).toBe("beat-1");
  expect(team.slides[0].sentences).toEqual([
    { sentence_id: "beat-1-sentence-1", text: "Let's start with the pilots.", evidence_ids: [] },
    { sentence_id: "beat-1-sentence-2", text: "Alpha recorded 42 pilots.", evidence_ids: ["P1"] },
    { sentence_id: "beat-1-sentence-3", text: "Beta recorded 51.", evidence_ids: ["P1"] },
  ]);
  expect(team.pitch?.estimated_seconds).toBe(estimate_pitch_seconds(team.slides));
  expect(team.pitch?.estimated_seconds).toBeLessThanOrEqual(60);
  expect(hiring.slides).toHaveLength(1);
  expect(hiring.slides[0].title).toBe("Jordan’s documented leadership");
  expect(hiring.slides[0].sentences?.map(sentence => sentence.text)).toEqual([
    "The record shows Jordan led the onboarding team in 2025.", "We can discuss that role next.",
  ]);
});

test("unsupported numeric narration is rejected and invalid plotted points are withheld", async () => {
  const pitch: TPitchInput = { audience: "Team", duration_minutes: 1, slide_count: 1 };
  const beat = { title: "Pilot results", highlights: ["Alpha recorded 42 pilots."], evidence_ids: ["P1"],
    sentences: [spoken("Alpha recorded 42 pilots.", "P1")],
    template: { type: "bar_chart", unit: "pilots", points: [{ label: "Alpha", value: 51 }, { label: "Beta", value: 42 }] } };
  const downgraded = await prepare_pitch(saved, pitch, async () => ({ rationale: "Bad chart", beats: [beat] }), verified);
  expect(downgraded.slides[0].template).toEqual({ type: "bullet_slide" });
  const invalid = await prepare_pitch(saved, pitch, async () => ({ rationale: "Bad narration",
    beats: [{ ...beat, sentences: [spoken("Alpha completed 999 pilots.", "P1")] }] }), async () => {
    throw new Error("The numeric gate should reject before review");
  });
  expect(invalid.pitch?.rationale).toContain("saved, verified talk track");
  expect(JSON.stringify(invalid)).not.toContain("999");
});

test("independent review rejects unsupported paraphrases and uses distinct verified fallback headings", async () => {
  const provider = research_provider(config);
  let checked = false;
  provider.verify = async review => {
    checked = review.units.some(unit => unit.text === "Jordan won an award." && unit.support.some(ref => ref.evidence_id === "P2"));
    return review.units.map(unit => ({ id: unit.id, decision: unit.text === "Jordan won an award." ? "unsupported" : "supported" }));
  };
  const deck = await prepare_pitch({ ...saved, pitch_script: undefined }, { audience: "Leadership", duration_minutes: 1, slide_count: 2 },
    async () => ({ rationale: "Unsupported detail", beats: [{ title: "An award", highlights: [leadership],
      evidence_ids: ["P2"], sentences: [spoken("Jordan won an award.", "P2")], template: { type: "bullet_slide" } }] }),
    presentation_plan_review(provider));
  expect(checked).toBe(true);
  expect(deck.slides.map(slide => slide.title)).toEqual(["Leadership", "Pilot results"]);
  expect(JSON.stringify(deck)).not.toContain("won an award");
});

test("a rejected introduction cannot discard the consecutive verified beats", async () => {
  const provider = research_provider(config);
  provider.verify = async review => review.units.map(unit => ({ id: unit.id,
    decision: unit.text.includes("won an award") ? "unsupported" : "supported" }));
  let calls = 0;
  const deck = await prepare_pitch(saved, { audience: "Hiring panel", duration_minutes: 1 }, async () => {
    calls++;
    return { rationale: "Present documented leadership and pilot results.", beats: [
      { title: "Introduction", highlights: [leadership], evidence_ids: ["P2"], sentences: [spoken("Jordan won an award.", "P2")],
        template: { type: "title_card" } },
      { title: "Documented leadership", highlights: [leadership], evidence_ids: ["P2"], sentences: [spoken(leadership, "P2")],
        template: { type: "bullet_slide" } },
      { title: "Pilot participation", highlights: ["Alpha recorded 42 pilots."], evidence_ids: ["P1"],
        sentences: [spoken("Alpha recorded 42 pilots.", "P1")], template: { type: "bullet_slide" } },
    ] };
  }, presentation_plan_review(provider));
  expect(calls).toBe(1);
  expect(deck.slides.map(slide => [slide.slide_id, slide.title, slide.layout])).toEqual([
    ["slide-2", "Documented leadership", "headline"], ["slide-3", "Pilot participation", "takeaway"],
  ]);
  expect(deck.slides[0].sentences?.[0].sentence_id).toBe("beat-2-sentence-1");
  expect(deck.pitch?.rationale).toContain("consecutive slides with checked content");
  expect(JSON.stringify(deck)).not.toContain("won an award");
});

test("no verified candidate triggers one targeted repair and a fresh review before publication", async () => {
  const provider = research_provider(config);
  let reviews = 0;
  provider.verify = async review => {
    reviews++;
    return review.units.map(unit => ({ id: unit.id, decision: unit.text.includes("won an award") ? "unsupported" : "supported",
      reason: unit.text.includes("won an award") ? "The evidence establishes only the role." : undefined }));
  };
  let proposals = 0;
  const deck = await prepare_pitch(saved, { audience: "Hiring panel", duration_minutes: 1 }, async context => {
    proposals++;
    if (proposals === 2) expect(context.review_feedback?.join(" ")).toContain("The evidence establishes only the role.");
    return { rationale: "Describe the stated role.", beats: [{
      title: "Evidence for the role", template: { type: "bullet_slide" }, highlights: [leadership], evidence_ids: ["P2"],
      sentences: [spoken(proposals === 1 ? "Jordan won an award." : leadership, "P2")],
    }] };
  }, presentation_plan_review(provider));
  expect(proposals).toBe(2);
  expect(reviews).toBe(2);
  expect(deck.slides[0].title).toBe("Evidence for the role");
  expect(deck.slides[0].sentences?.[0].text).toBe(leadership);
});

test("planner falls back to the saved talk track and enforces time even with a requested slide count", async () => {
  const unavailable = async () => { throw new Error("Offline"); };
  const deck = await prepare_pitch(saved, { audience: "", duration_minutes: 1, slide_count: 20 }, unavailable);
  expect(deck.pitch?.audience).toBe("New team");
  expect(deck.slides).toHaveLength(4);
  expect(deck.pitch?.rationale).toContain("fewer supported beats");
  expect(deck.pitch?.estimated_seconds).toBeLessThanOrEqual(60);
  await expect(prepare_pitch(saved, { audience: "", duration_minutes: 1, slide_count: 1,
    demo: { url: "https://portfolio.example/", objective: "Show the pilot", seconds: 60 } }, unavailable)).rejects.toThrow("No approved narration fits");
});

test("Module 2 plans narration from verified context when no talk track has been saved", async () => {
  const deck = await prepare_pitch({ ...saved, pitch_script: undefined }, { audience: "", duration_minutes: 1 }, async context => {
    expect(context.talk_track.map(item => item.narration)).toEqual([results, leadership]);
    return { rationale: "Lead with the documented project results.", beats: [
      { title: "Pilot results", highlights: ["Alpha recorded 42 pilots."], evidence_ids: ["P1"],
        sentences: [spoken("Alpha recorded 42 pilots. Beta recorded 51 pilots.", "P1")],
        template: { type: "bullet_slide" } },
    ] };
  }, verified);
  expect(deck.slides[0].sentences?.map(sentence => sentence.text)).toEqual([
    "Alpha recorded 42 pilots.", "Beta recorded 51 pilots.",
  ]);
  expect(deck.slides[0].evidence_ids).toEqual(["P1"]);
});

test("legacy reports without verification metadata retain their existing compiler and pitch API shape", async () => {
  let called = false;
  const deck = await prepare_pitch({ ...saved, grounding: undefined, pitch_script: undefined }, { audience: "", duration_minutes: 1 }, async () => {
    called = true;
  });
  expect(called).toBe(false);
  expect(deck.slides[0].layout).toBe("headline");
  expect(deck.slides[0].sentences).toBeUndefined();
});

test("preparing the same settings uses the updated planner without dropping a saved deck", async () => {
  const store = new SessionStore(":memory:");
  const pitch = { audience: "New team", duration_minutes: 1 };
  const offline = async () => undefined;
  const previous = store.decks.create("owner", await prepare_pitch(saved, pitch, offline), JSON.stringify([2, "new team", 1]));
  const key = pitch_variant_key(pitch);
  expect(store.decks.for_research("owner", saved.research_id, key)).toBeFalsy();
  const current = store.decks.create("owner", await prepare_pitch(saved, pitch, offline), key);
  expect(current.deck_id).not.toBe(previous.deck_id);
  expect(store.decks.get("owner", previous.deck_id)).toEqual(previous);
  expect(store.decks.for_research("owner", saved.research_id, key)?.deck_id).toBe(current.deck_id);
});
