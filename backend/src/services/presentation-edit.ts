import { AppError } from "../errors/app-error";
import type { TDeck, TEditRequest, TEditProposal } from "../types/deck";
import type { TLiveDecision, TLiveTurnContext, TLiveTurnInput } from "../types/live-turn";
import type { TEvidence, TResearchBundle } from "../types/research";
import { deck_sources, live_edit_input, propose_slide } from "./deck";
import { quotes } from "./excerpt";
import type { TPresentationClaim } from "./presentation-grounding";
import { presentation_sentences } from "./presentation-live";
import { template_supported } from "./presentation-planner";
import { contains_draft_instruction } from "./slide-content";

export type TGroundedPresentationEdit = { kind: "edit"; text: string; request: TEditRequest;
  attribution: NonNullable<TEditProposal["attribution"]>; sources: NonNullable<TDeck["sources"]> };

const numbers = (text: string) => [...text.matchAll(/(?<![\p{L}\p{N}])(?:\p{Sc})?\p{N}+(?:[.,]\p{N}+)*(?:%|[kKmMbB]\+?|\+)?/gu)].map(match => match[0].replace(/,/gu, "").toLowerCase());
export const numeric_tokens = (items: string[]) => new Set(items.flatMap(numbers));
const same_words = (left: string, right: string) => quotes(left, right) && quotes(right, left);

const reject = (text: string) => ({ kind: "clarify" as const, text });

export const prepare_presentation_edit = (turn: TLiveTurnInput, decision: Extract<TLiveDecision, { kind: "edit" }>,
  context: TLiveTurnContext, research: TResearchBundle): TGroundedPresentationEdit | ReturnType<typeof reject> => {
  const { slide, evidence } = context;
  const support = decision.support ?? [];
  const valid = support.length && support.every(ref => ref.excerpt.length <= 1500 &&
    (ref.evidence_id === "host" ? quotes(turn.message, ref.excerpt) : evidence.some(row => row.id === ref.evidence_id && quotes(row.passage, ref.excerpt))));
  if (!valid) return reject("Which source or exact detail should I use for that change?");
  const additions = decision.additions;
  const requested = { ...decision.changes };
  if (additions?.highlights?.length) {
    const highlights = [...slide.highlights];
    for (const highlight of additions.highlights) {
      if (!highlights.some(existing => same_words(existing, highlight))) highlights.push(highlight);
    }
    if (highlights.length > 4) return reject("This slide has room for four highlights. Which one should I replace?");
    requested.highlights = highlights;
  }
  if (additions?.narration?.trim()) requested.narration = [slide.narration.trim(), additions.narration.trim()].join(" ");
  const request = live_edit_input.safeParse({ base_revision: turn.base_revision, command_id: turn.turn_id, slide_id: turn.slide_id, changes: requested });
  if (!request.success) return reject("Which title, point or narration sentence should change?");
  const { changes } = request.data;
  if (contains_draft_instruction(changes)) return reject("What factual point should the audience see or hear?");
  if (changes.template && !template_supported(changes.template, support.map(ref => ({
    id: ref.evidence_id, origin: "host", location: "Verified verbatim excerpt", passage: ref.excerpt,
  })))) return reject("Which source contains the labels and values for that visual?");
  const speech = changes.narration ? presentation_sentences({ ...slide, narration: changes.narration }).map(sentence => sentence.text) : [];
  const changed = [changes.title, ...(changes.highlights ?? []), ...speech].filter((value): value is string => Boolean(value));
  if ((changes.narration && same_words(changes.narration, turn.message)) ||
      changed.some(value => same_words(value, turn.message))) return reject("What factual point should the audience see or hear?");
  const known = numeric_tokens([slide.title, slide.narration, ...slide.highlights, ...support.map(item => item.excerpt)]);
  if ([...numeric_tokens(changed)].some(value => !known.has(value))) return reject("Can you confirm the exact number or its source?");
  try { propose_slide(slide, changes); }
  catch (error) {
    if (error instanceof AppError && error.status === 400) return reject(error.message);
    throw error;
  }
  const used = new Set(support.map(ref => ref.evidence_id));
  const sources = deck_sources(research, used);
  return { kind: "edit", text: decision.text, request: request.data, attribution: support, sources };
};

export const presentation_edit_claims = (route: TGroundedPresentationEdit, context: TLiveTurnContext): TPresentationClaim[] => {
  const { slide } = context;
  const { changes } = route.request;
  const old = [slide.title, ...slide.highlights, ...presentation_sentences(slide).map(sentence => sentence.text)];
  const new_sentences = changes.narration ? presentation_sentences({ ...slide, narration: changes.narration }).map(sentence => sentence.text) : [];
  const changed = [changes.title, ...(changes.highlights ?? []), ...new_sentences]
    .filter((text): text is string => !!text && !old.some(prior => same_words(prior, text)));
  const visual = changes.template;
  if (visual && visual.type !== "title_card" && visual.type !== "bullet_slide" &&
      JSON.stringify(visual) !== JSON.stringify(slide.template)) {
    changed.push(JSON.stringify(visual));
  }
  return [...new Set(changed)].map(text => ({ text, support: route.attribution }));
};

export const presentation_claim_evidence = (claims: TPresentationClaim[], research: TResearchBundle, message: string): TEvidence[] => {
  const ids = new Set(claims.flatMap(claim => claim.support.map(ref => ref.evidence_id)));
  const evidence = research.evidence.filter(row => ids.has(row.id));
  if (ids.has("host")) evidence.push({ id: "host", origin: "host", location: "Host statement in this turn", passage: message });
  return evidence;
};
