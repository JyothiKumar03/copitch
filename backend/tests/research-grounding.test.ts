import { test, expect } from "bun:test";
import { createOpenAI } from "@ai-sdk/openai";
import { research_provider } from "../src/services/research-provider";
import { build_research } from "../src/services/research";
import { compile_deck } from "../src/services/deck";
import type { TGroundingReview, TResearchBrief, TResearchDraft, TResearchProvider } from "../src/types/research";
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
    const verdicts = inspected.units.map(unit => ({ id: unit.id, decision: unit.kind === "paragraph" ? "missing_qualification" : "unsupported" }));
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
    const verdicts = await adapter.verify!(review, signal);
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

test("incomplete, absent, failed and over-budget verifiers publish only extracts", async () => {
  for (const verify of [undefined, async () => [], async () => { throw Error("offline"); },
    async () => Array.from({ length: 3 }, () => ({ id: "title", decision: "supported" as const }))]) {
    const result = await build_research(brief, { ...source(), verify }, new AbortController().signal, () => {});
    expect(result.grounding?.mode).toBe("source_extracts");
    expect(result.markdown).not.toContain(bad);
  }
  let checks = 0;
  const oversized = source({ ...proposal, title: "X".repeat(50000) });
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
