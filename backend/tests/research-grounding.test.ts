import { test, expect } from "bun:test";
import { createOpenAI } from "@ai-sdk/openai";
import { research_provider } from "../src/services/research-provider";
import { build_research } from "../src/services/research";
import { compile_deck } from "../src/services/deck";
import { verify_draft } from "../src/services/research-grounding";
import type { TEvidence, TGroundingReview, TResearchBrief, TResearchDraft, TResearchProvider } from "../src/types/research";
import type { TResearchCheckpoint } from "../src/types/research-job";

const material = "Four of twenty enterprise trials converted. This was observational and lacked a comparison group.";
const brief: TResearchBrief = {
  brief_id: "buyer", messages: ["Pitch the buyer a pilot."], summary: "Propose a pilot.", question: null,
  public_queries: [], urls: [], source_policy: "files_only", materials: material,
};
const bad = "A randomized trial proved our onboarding tripled conversions.";
const proposal: TResearchDraft = { title: "Triple conversion", gaps: ["Causal impact is unknown."], sections: [
  { heading: "Guaranteed ROI", paragraphs: [{ prose: bad, support: [{ evidence_id: "M1", excerpt: "Four of twenty" }] }] },
] };

const source = (draft = proposal): TResearchProvider => {
  return {
    clarify: async () => { throw Error("Unused"); }, lookup: async () => { throw Error("Unused"); },
    draft: async () => draft,
  };
};

test("production verifier examines headings, claims and missing qualifiers independently of synthesis", async () => {
  let inspected: TGroundingReview | undefined;
  const openai = createOpenAI({ apiKey: "fixture", fetch: async (_url, request) => {
    const wire = JSON.parse(request!.body as string);
    const user_input = wire.input.find((turn: { role: string }) => turn.role === "user");
    inspected = JSON.parse(user_input.content[0].text) as TGroundingReview;
    const verdicts = inspected.units.map(unit => ({ id: unit.id, decision: unit.kind === "paragraph" ? "missing_qualification" : "unsupported", reason: null }));
    return Response.json({ id: "fixture", model: "fake", status: "completed", created_at: 1,
      output: [{ type: "message", role: "assistant", id: "reply", status: "completed",
        content: [{ type: "output_text", text: JSON.stringify({ verdicts }), annotations: [] }] }],
      usage: { input_tokens: 60, output_tokens: 40 },
    });
  } });
  const provider = source();
  const adapter = research_provider({ provider: "openai", model: "fake", max_output_tokens: 1024, tool_providers: [] }, openai);
  let decisions: string[] = [];
  provider.verify = async (review, signal) => {
    const result = await adapter.verify!(review, signal);
    const verdicts = Array.isArray(result) ? result : result.verdicts;
    decisions = verdicts.map(v => v.decision);
    return verdicts;
  };
  const result = await build_research(brief, provider, AbortSignal.timeout(2000), () => {});
  expect(decisions).toEqual(["unsupported", "unsupported", "missing_qualification"]);
  expect(inspected?.units.map(u => u.text)).toEqual(["Triple conversion", "Guaranteed ROI", bad]);
  expect(inspected?.evidence.map(e => e.passage)).toContain(material);
  expect(inspected?.gaps).toContain("Causal impact is unknown.");
  expect(result.grounding?.mode).toBe("source_extracts");
  const deck = compile_deck(result);
  expect(JSON.stringify(deck)).not.toContain("tripled");
  expect(JSON.stringify(deck)).not.toContain("Guaranteed ROI");
  expect(deck.slides[0].narration).toContain("observational and lacked a comparison group");
  expect(deck.title).toBe("Source extracts");
});

test("production verifier identifies goal-specific omissions in the same call without expanding unit citations", async () => {
  const relevant = { id: "P2", origin: "public" as const, location: "Pilot register", passage: "The pilot ran in March 2025." };
  let inspected: TGroundingReview | undefined;
  let calls = 0;
  const openai = createOpenAI({ apiKey: "fixture", fetch: async (_url, request) => {
    calls++;
    const wire = JSON.parse(request!.body as string);
    const user_input = wire.input.find((turn: { role: string }) => turn.role === "user");
    inspected = JSON.parse(user_input.content[0].text) as TGroundingReview;
    const verdicts = inspected.units.map(unit => ({ id: unit.id, decision: unit.kind === "paragraph" ? "unsupported" : "supported", reason: null }));
    const valid = { finding: "the March 2025 reporting period", reason: "The approved brief asks when the pilot ran.", evidence_ids: ["P2"] };
    const omissions = [valid, valid, { ...valid, finding: "an invented comparison", evidence_ids: ["P9"] }];
    return Response.json({ id: "fixture", model: "fake", status: "completed", created_at: 1,
      output: [{ type: "message", role: "assistant", id: "reply", status: "completed",
        content: [{ type: "output_text", text: JSON.stringify({ verdicts, omissions }), annotations: [] }] }],
      usage: { input_tokens: 200, output_tokens: 90 },
    });
  } });
  const provider = research_provider({ provider: "openai", model: "fake", max_output_tokens: 1024, tool_providers: [] }, openai);
  const draft = { ...proposal, title: "Pilot brief", sections: [{ heading: "Pilot status", paragraphs: [
    { prose: "The pilot ran in March 2025.", support: [{ evidence_id: "M1", excerpt: "Four of twenty" }] },
  ] }] };
  const evidence = [{ id: "M1", origin: "material" as const, location: "Supplied records", passage: material }, relevant];
  const approved = { ...brief, summary: "Tell the buyer when the pilot ran." };
  const result = await verify_draft(draft, evidence, [], provider, AbortSignal.timeout(2_000), undefined, undefined, approved);
  expect(calls).toBe(1);
  expect(inspected?.evidence.map(record => record.id)).toEqual(["M1"]);
  expect(inspected?.coverage?.brief.summary).toBe(approved.summary);
  expect(inspected?.coverage?.evidence).toEqual([relevant]);
  expect(result.decisions?.get("paragraph-0-0")).toBe("unsupported");
  expect(result.coverage_feedback).toEqual([
    "Consider adding the March 2025 reporting period (source records P2). The approved brief asks when the pilot ran.",
  ]);
});

test("oversized uncited records cannot consume the entitlement check or license feedback", async () => {
  const evidence = [
    { id: "M1", origin: "material" as const, location: "Supplied records", passage: material },
    { id: "P2", origin: "public" as const, location: "Oversized source", passage: "é".repeat(40_000) },
    { id: "P3", origin: "public" as const, location: "Compact source", passage: "The pilot ran in March 2025." },
  ];
  const provider = source();
  provider.verify = async review => {
    expect(Buffer.byteLength(JSON.stringify(review), "utf8")).toBeLessThan(120_000);
    expect(review.coverage?.evidence.map(row => row.id)).toEqual(["P3"]);
    return { verdicts: review.units.map(u => ({ id: u.id, decision: "supported" })),
      omissions: [{ finding: "an unknown result", reason: "The host asked for a result.", evidence_ids: ["P2"] }] };
  };
  const result = await verify_draft(proposal, evidence, [], provider, AbortSignal.timeout(2_000), undefined, undefined, brief);
  expect(result.prose).toBe(true);
  expect(result.coverage_feedback).toEqual([]);
});

test("incomplete, absent, failed and over-budget verifiers publish only extracts", async () => {
  for (const verify of [undefined, async () => [], async () => { throw Error("offline"); },
    async () => Array.from({ length: 3 }, () => ({ id: "title", decision: "supported" as const }))]) {
    const result = await build_research(brief, { ...source(), verify }, new AbortController().signal, () => {});
    expect(result.grounding?.mode).toBe("source_extracts");
    expect(result.markdown).not.toContain(bad);
  }
  let checks = 0;
  const oversized = source({ ...proposal, title: "X".repeat(150000) });
  oversized.verify = async () => { checks++; return []; };
  const result = await build_research(brief, oversized, new AbortController().signal, () => {});
  expect(checks).toBe(0);
  expect(result.grounding?.mode).toBe("source_extracts");
});

test("all approved units retain their qualified narration and the checked checkpoint is reusable", async () => {
  const safe = { ...proposal, title: "Pilot results", sections: [{ heading: "Enterprise trials", paragraphs: [
    { prose: material, support: [{ evidence_id: "M1", excerpt: material }] },
  ] }] };
  const provider = source(safe);
  let calls = 0;
  provider.verify = async r => { calls++; return r.units.map(u => ({ id: u.id, decision: "supported" })); };
  let saved: TResearchCheckpoint | undefined;
  const result = await build_research(brief, provider, new AbortController().signal, () => {}, undefined, s => { saved = s; });
  expect(result.grounding?.mode).toBe("verified");
  expect(compile_deck(result).slides[0].narration).toBe(material);
  const recovered = await build_research(brief, provider, new AbortController().signal, () => {}, saved);
  expect(calls).toBe(1);
  expect(recovered.findings).toEqual(result.findings);
});

test("studio verification rejects a mistaken quantity scale while preserving a rounded equivalent", async () => {
  const passage = "Total exports were 19,72,018 tonnes.\n(Values in Million USD)\nApril–October | 5523.20";
  const evidence: TEvidence[] = [{ id: "P1", origin: "public", location: "Official table", passage }];
  const support = [{ evidence_id: "P1", excerpt: passage }];
  const result = await verify_draft({ title: "Exports", gaps: [], sections: [{ heading: "Reported quantities", paragraphs: [
    { prose: "Total exports reached 19.72 million tonnes.", support },
    { prose: "Total exports reached 1.97 million tonnes.", support },
    { prose: "Exports reached USD 5,523.20 million.", support },
  ] }] }, evidence, [], { ...source(), verify: async review => review.units.map(unit => ({ id: unit.id, decision: "supported" })) },
  AbortSignal.timeout(1000), undefined, undefined, brief);
  expect(result.decisions?.get("paragraph-0-0")).toBe("unsupported");
  expect(result.decisions?.get("paragraph-0-1")).toBe("supported");
  expect(result.decisions?.get("paragraph-0-2")).toBe("supported");
});

test("reported table values use the explicit magnitude legend on the same source only", async () => {
  const public_url = "https://example.org/exports";
  const passage = "TOTAL Q: 1698170 1972018\nV: 62408.45 73890.46\n$: 7453.73 8455.76";
  const evidence: TEvidence[] = [
    { id: "P1", origin: "public", location: "Legend", url: public_url, passage: "Units for all data: Q: Quantity in MT, V: Value in Rs. Crore, $: US Dollar Million" },
    { id: "P2", origin: "public", location: "Table excerpt", url: public_url, passage },
    { id: "P3", origin: "public", location: "Unrelated table", url: public_url + "/other", passage },
  ];
  const result = await verify_draft({ title: "Exports", gaps: [], sections: [{ heading: "Totals", paragraphs: [
    { prose: "Exports reached USD 8,455.76 million.", support: [{ evidence_id: "P2", excerpt: passage }] },
    { prose: "Exports reached USD 84,557.60 million.", support: [{ evidence_id: "P2", excerpt: passage }] },
    { prose: "Exports reached USD 8,455.76 million.", support: [{ evidence_id: "P3", excerpt: passage }] },
  ] }] }, evidence, [], { ...source(), verify: async review => review.units.map(unit => ({ id: unit.id, decision: "supported" })) },
  AbortSignal.timeout(1000), undefined, undefined, brief);
  expect(result.decisions?.get("paragraph-0-0")).toBe("supported");
  expect(result.decisions?.get("paragraph-0-1")).toBe("unsupported");
  expect(result.decisions?.get("paragraph-0-2")).toBe("unsupported");
});
