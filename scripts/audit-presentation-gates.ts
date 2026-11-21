import { readFileSync } from "node:fs";

const paths = [
  "shared/presentation.ts",
  "backend/src/controllers/deck.ts",
  "backend/src/workers/deck-preparation.ts",
  "backend/src/repositories/deck-preparation.ts",
  "backend/src/services/presentation-readiness.ts",
  "backend/src/services/presentation-planner.ts",
  "backend/src/services/deck-render-review.ts",
  "backend/src/services/research-agent.ts",
  "backend/src/services/research-grounding.ts",
  "backend/src/services/research-graphs.ts",
  "backend/src/services/research.ts",
  "backend/src/services/host-pages.ts",
  "backend/src/constants/sources.ts",
  "frontend/lib/decks.ts",
];

const gates = [
  ["budget", /AbortSignal\.timeout|\.slice\(0,\s*(?:\d|\w+_limit)|max_output_tokens|maxOutputTokens|outstanding|(?:deadline|budget|_limit)\s*=/u],
  ["count", /slide_count|sections\.length|beats\.length|MAX_PRESENTATION_SLIDES|checklist_max/u],
  ["policy", /files_only|public_search|research_mode|readiness_probability/u],
  ["degradation", /\bfallback\b|\bwithheld\b|verification_skipped|unavailable|incomplete_review|retryable/u],
] as const;

for (const path of paths) {
  const lines = readFileSync(path, "utf8").split("\n");
  for (const [index, line] of lines.entries()) {
    const rule = line.trim();
    if (!rule || rule.startsWith("//") || rule.startsWith("*")) continue;
    const labels = gates.flatMap(([label, match]) => match.test(rule) ? [label] : []);
    if (labels.length) console.log(`${path}:${index + 1} [${labels.join(", ")}] ${rule}`);
  }
}
