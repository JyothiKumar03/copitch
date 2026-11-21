import type { TAttempt } from "../types/ai";
import type { TEvidence, TGroundingUnit } from "../types/research";
import { quotes } from "./excerpt";
import { configured_models_for } from "./model-config";
import { research_provider } from "./research-provider";

export type TPresentationClaim = Pick<TGroundingUnit, "text" | "support">;

export const verify_presentation_claims = async (claims: TPresentationClaim[], evidence: TEvidence[], signal: AbortSignal,
  on_attempt?: (attempt: TAttempt) => void) => {
  const records = new Map(evidence.map(row => [row.id, row]));
  const units: TGroundingUnit[] = [];
  for (const claim of claims) {
    if (!claim.text.trim() || !claim.support.length || !claim.support.every(ref => quotes(records.get(ref.evidence_id)?.passage, ref.excerpt))) return false;
    if (claim.support.some(ref => {
      const passage = records.get(ref.evidence_id)!.passage;
      return quotes(passage, claim.text) && quotes(claim.text, passage);
    })) continue;
    units.push({ ...claim, id: `claim-${units.length + 1}`, kind: "paragraph" });
  }
  if (signal.aborted) return false;
  if (!units.length) return true;
  const [model] = configured_models_for("live");
  if (!model || !process.env.OPENAI_API_KEY || units.length > 20) return false;
  const ids = new Set(units.flatMap(unit => unit.support.map(ref => ref.evidence_id)));
  const review = { units, evidence: evidence.filter(record => ids.has(record.id)), gaps: [] };
  if (Buffer.byteLength(JSON.stringify(review), "utf8") > 48_000) return false;
  try {
    const result = await research_provider(model).verify!(review, AbortSignal.any([signal, AbortSignal.timeout(12_000)]), on_attempt);
    const verdicts = Array.isArray(result) ? result : result.verdicts;
    const decisions = new Map(verdicts.map(verdict => [verdict.id, verdict.decision]));
    return !signal.aborted && verdicts.length === units.length && decisions.size === units.length &&
      units.every(unit => decisions.get(unit.id) === "supported");
  } catch { return false; }
};
