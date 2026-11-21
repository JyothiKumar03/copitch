import { expect, test } from "bun:test";
import { score_portfolio_pitch } from "./pitch_coverage_eval";

const profile = [
  "Jyothi Kumar is an AI engineer.",
  "He completed a bachelor's at KMIT from December 2020 to June 2024, with a GPA of 8.98.",
  "He currently drives AI Solutions at InspireLabs.",
  "ProdGain employed him as a software engineer from Jun 2024 through Feb 2026.",
  "ADP employed him as a software developer intern from July–October 2023.",
  "He was a full-stack engineer at Brainlox from Feb 2023 to March 2023.",
  "He was an R&D intern at KMIT/Teleparadigm Networks from September 2022 to December 2022.",
  "His sales CRM pipeline processed 30,000+ calls, emails, and meetings.",
  "His agents ran more than 500 tool calls with 90% accuracy.",
  "He improved LLM performance by 70% with context engineering and RAG.",
  "He wrote ‘Reliability-first LLM systems’.",
];
const work = [
  "just-jev-it handles typed decisions.",
  "agent-spawnkit delegates to workers.",
  "trace-ur-token shows where tokens go.",
  "LiveSlides presents a deck.",
  "Aarogya answers insurance questions.",
  "Merchant Underwriting Agent scores merchants.",
  "Research Paper Judge reviews arXiv papers.",
  "Voice Tutor teaches Spanish.",
  "Critic Agent designs a rubric.",
  "Dev Debugger answers debugging questions over your codebase.",
  "Unified LLM Wrapper unifies multiple providers.",
  "Prescription AI Webapp interprets handwritten prescriptions.",
  "AWS DNS Dashboard monitors and edits records.",
  "Shoe Store Clone is a responsive storefront.",
  "ML Projects includes sentiment analysis.",
  "Samurai Stimulator is a fighting game.",
];

const artifact = [
  "# Introduction",
  "## Profile",
  ...profile.map(line => line + " [^P1]"),
  "## Work",
  ...work.map(line => line + " [^P2]"),
  "## Talk track",
  "I am Jyothi Kumar, an AI engineer. [^P1]",
  "## Evidence gaps",
  "- The site gives no start date for InspireLabs.",
  "## Sources",
  "[^P1]: [Home](<https://www.jk-ai.in/#experience>) (public).",
  "[^P2]: [Projects](<https://www.jk-ai.in/projects>) (public).",
].join("\n\n");

test("scores all reviewed portfolio facts in the cited brief and recognizes the separate talk track", () => {
  expect(score_portfolio_pitch(artifact)).toMatchObject({
    coverage: 1, covered: 30, total: 30, threshold: 0.9, talk_track: true, explicit_gaps: true, passed: true, missing: [],
  });
});

test("fails above the score threshold when a role, number, or project is missing", () => {
  for (const [before, after, id] of [
    ["Jun 2024 through Feb 2026", "Jun 2024 through Mar 2026", "role:prodgain"],
    ["30,000+ calls, emails, and meetings", "30,000+ projects", "impact:30k"],
    ["Aarogya answers insurance questions.", "Aarogya.", "project:aarogya-medical-support"],
  ]) {
    const report = score_portfolio_pitch(artifact.replace(before, after));
    expect(report.coverage).toBeGreaterThan(report.threshold);
    expect(report.passed).toBe(false);
    expect(report.missing).toContainEqual({ id, required: true });
  }
});

test("does not accept unmatched, unrelated, or missing citations or facts that appear only in a gap or code block", () => {
  expect(score_portfolio_pitch(artifact.replace("www.jk-ai.in/projects", "www.jk-ai.in.example.test/projects")).covered).toBe(14);
  expect(score_portfolio_pitch(artifact.replace("www.jk-ai.in/projects", "www.jk-ai.in/blog")).covered).toBe(14);
  expect(score_portfolio_pitch(artifact.replace("www.jk-ai.in/projects", "www.jk-ai.in/")).covered).toBe(20);
  const work_without_source = artifact.replaceAll(". [^P2]", ".");
  const cited_names_in_gaps = work_without_source.replace("## Evidence gaps", "## Evidence gaps\n\n" + work.map(line => line + " [^P2]").join("\n"));
  expect(score_portfolio_pitch(cited_names_in_gaps).covered).toBe(14);
  const cited_code = work_without_source.replace("## Work", "## Work\n\n```text\n" + work.map(line => line + " [^P2]").join("\n") + "\n```");
  expect(score_portfolio_pitch(cited_code).covered).toBe(14);
  expect(score_portfolio_pitch(artifact.replace("I am Jyothi Kumar, an AI engineer. [^P1]", "I am Jyothi Kumar. [^P3]")).passed).toBe(false);
});
