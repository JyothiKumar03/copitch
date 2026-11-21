import { portfolio_facts, portfolio_threshold, portfolio_url } from "./portfolio_reference";

const reference_host = new URL(portfolio_url).hostname.replace(/^www\./u, "");
const citation_tag = /\[\^([A-Z]\d+)\]/gu;
const source_definition = /^\[\^([A-Z]\d+)\]:\s+\[.+?\]\(<?(https?:\/\/[^>\s)]+)>?\)\s+\(public\)\./u;

const first_party_path = (input: string): string | undefined => {
  try {
    const url = new URL(input);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return;
    if (url.hostname.replace(/^www\./u, "") === reference_host) return url.pathname.replace(/\/$/u, "") || "/";
  } catch { /* A malformed source definition cannot establish provenance. */ }
};

const normalize = (value: string) => value.normalize("NFKC").toLowerCase()
  .replace(/&(?:amp|#38|#x26);/gu, "&").replace(/[‐‑‒–—−]/gu, "-").replace(/\u2019/gu, "'").replace(/\\([\\`*_{}[\]<>#!|~])/gu, "$1");

export const is_context_document = (markdown: string) => /^#\s+\S/mu.test(markdown) &&
  !/^#{2,6}\s+(?:[\d.]+\s+)?(?:talk track|brief talk track|speaker notes|pitch script|recommended .*slide structure)\b/imu.test(markdown);

export const read_cited_pitch = (markdown: string) => {
  const sources = new Map<string, string>();
  const claims: { text: string; citations: string[]; section: string }[] = [];
  let section = "";
  let fenced: "```" | "~~~" | undefined;
  let explicit_gaps = false;
  for (const raw of markdown.split(/\r?\n/u)) {
    const line = raw.trim();
    const fence = line.startsWith("```") ? "```" : line.startsWith("~~~") ? "~~~" : undefined;
    if (fence) {
      if (fence === fenced) fenced = undefined;
      else if (!fenced) fenced = fence;
      continue;
    }
    if (fenced || !line) continue;
    const heading = /^##\s+(.+)$/u.exec(line);
    if (heading) section = normalize(heading[1]);
    if (line.startsWith("#")) continue;
    if (section === "sources") {
      const definition = source_definition.exec(line);
      if (definition) sources.set(definition[1], definition[2]);
      continue;
    }
    const citations = [...line.matchAll(citation_tag)].map(match => match[1]);
    if (section === "evidence gaps") {
      explicit_gaps = true;
      continue;
    }
    const text = normalize(line.replace(citation_tag, "")).trim();
    if (!line.startsWith("[^") && text && citations.length) claims.push({ text, citations, section });
  }
  return { claims, sources, explicit_gaps };
};

export const score_portfolio_pitch = (markdown: string, context = false, reference = portfolio_facts) => {
  const { claims, sources, explicit_gaps } = read_cited_pitch(markdown);
  const citation_paths = new Map([...sources].map(([id, url]) => [id, first_party_path(url)]));

  const checks = reference.map(({ id, required = false, terms, paths }) => ({
    id, required,
    cited: claims.some(claim => claim.section !== "talk track" && terms.every(term => term.test(claim.text)) && claim.citations.some(citation => {
      const path = citation_paths.get(citation);
      return path !== undefined && paths.includes(path);
    })),
  }));
  const covered = checks.filter(check => check.cited).length;
  const missing = checks.filter(check => !check.cited);
  const coverage = covered / checks.length;
  const talk_track = claims.some(claim => claim.section === "talk track" && claim.citations.some(id => citation_paths.get(id) !== undefined));
  return {
    source: portfolio_url, threshold: portfolio_threshold, coverage, covered, total: checks.length, talk_track, explicit_gaps,
    passed: coverage >= portfolio_threshold && (context ? is_context_document(markdown) : talk_track) && !missing.some(check => check.required),
    missing: missing.map(({ id, required }) => ({ id, required })),
  };
};

if (import.meta.main) {
  const file = process.argv[2];
  if (process.argv.length !== 3) throw new Error("Usage: bun simulations/studio/pitch_coverage_eval.ts <pitch.md>");
  const result = score_portfolio_pitch(await Bun.file(file).text());
  console.log(JSON.stringify(result, null, 2));
  if (!result.passed) process.exitCode = 1;
}
