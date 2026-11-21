import { AppError } from "../errors/app-error";
import type { TResearchBundle } from "../types/research";
import type { TResearchAgentState } from "../types/research-agent";
import { configured_models_for } from "./model-config";
import { collect_research } from "./research-agent";
import { research_provider } from "./research-provider";
import { create_research_sources, research_discovery_lookup } from "./research-tools";

export type TPresentationResearchCheckpoint = { gaps: string[]; collection?: TResearchAgentState };

export const research_for_presentation = async (
  bundle: TResearchBundle, slide_count: number, coverage: TPresentationResearchCheckpoint, signal: AbortSignal,
  check_current: () => void, checkpoint: (state: TResearchAgentState) => void,
): Promise<TResearchBundle> => {
  const brief = bundle.confirmed_brief;
  if (brief.source_policy !== "public_search") throw new AppError(422, "Add sources to the project and run research again to support the requested slide count.");
  const models = configured_models_for("research");
  if (!models[0] || !process.env.OPENAI_API_KEY) throw new AppError(503, "OpenAI is unavailable for follow-up research. Try again when the provider is connected.");
  const provider = research_provider(models[0], undefined, models);
  const additional = await collect_research({
    brief, evidence: bundle.evidence, gaps: [], signal, check_current, checkpoint,
    previous: coverage.collection,
    model_step: provider.collect_step!,
    lookup: research_discovery_lookup(create_research_sources(brief, provider.lookup, undefined, bundle.evidence)),
    presentation_coverage: {
      slide_count, gaps: coverage.gaps,
      existing_findings: bundle.findings.sections.map(section => section.heading),
    },
  });
  const used = new Set(bundle.findings.sections.flatMap(section =>
    section.paragraphs.flatMap(paragraph => paragraph.support.map(reference => reference.evidence_id + "\n" + reference.excerpt))));
  // Only exact excerpts from the research tool go into the working bundle. The deck still verifies the resulting
  // claims independently. Keep the original saved brief and research revision intact.
  const sections = additional.checklist.flatMap(item => {
    if (item.status !== "covered" || !item.evidence_id || !item.excerpt) return [];
    const key = item.evidence_id + "\n" + item.excerpt;
    if (used.has(key)) return [];
    used.add(key);
    return [{ heading: item.heading ?? item.question,
      paragraphs: [{ prose: item.excerpt, support: [{ evidence_id: item.evidence_id, excerpt: item.excerpt }] }] }];
  });
  return {
    ...bundle, evidence: additional.evidence,
    findings: { ...bundle.findings, sections: [...bundle.findings.sections, ...sections] },
    gaps: [...new Set([...bundle.gaps, ...additional.gaps])],
  };
};
