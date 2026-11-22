// Draft directions belong in recovery and approval UI. These patterns target missing-content markers
// while allowing ordinary instructions in the subject matter, such as a product walkthrough step.
export const is_draft_instruction = (text: string) => {
  const normalized = text.normalize("NFKC");
  return /[[{]\s*(?:tbd|placeholder|(?:add|insert)\s+[^\]}]+)\s*[\]}]/iu.test(normalized) ||
    /(?:^|[.!?\n]\s*)(?:[-*]\s*)?(?:please\s+)?(?:add|insert|supply|provide|fill in)\s+(?:one more|another|more|the missing|a supporting|a relevant|your own)\s+(?:source|data|evidence|figure|metric|number|example|detail|reference|content)s?\b/iu.test(normalized) ||
    /(?:^|[.!?\n]\s*)(?:(?:add|insert|place)\b[^.!?\n]{0,64}\b(?:here|on (?:this|the) slide|in this section)\b|(?:source|figure|metric|caption|example) to (?:add|insert)\b|(?:content|citation) (?:needed|pending)\b|see the full source passage in the research memo\b|tbd(?:\s*[.!?]|$))/iu.test(normalized);
};

export const contains_draft_instruction = (value: unknown): boolean => {
  if (typeof value === "string") return is_draft_instruction(value);
  return !!value && typeof value === "object" && Object.values(value).some(contains_draft_instruction);
};

// A reviewer sometimes fills a required omissions list with a placeholder ("No omission to report; …").
// That is the absence of a gap, never a gap to repair or show the host.
export const is_non_omission = (text: string) =>
  /^\s*(?:no|none|nothing)\b[^.;]{0,60}\b(?:omission|omitted|missing|gap|issue)s?\b/iu.test(text.normalize("NFKC")) ||
  /^\s*(?:none|n\/a|not applicable)\s*[.;]?\s*$/iu.test(text.normalize("NFKC"));
