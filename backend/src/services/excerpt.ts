// Whether a cited excerpt is really in its record. Typography is not meaning: curly and straight quotes, dash kinds,
// where whitespace falls (a site's line break between "ProdGain" and "Jun 2024") and letter case compare as equal.
const same_as: Record<string, string> = {
  "‘": "'", "’": "'", "‚": "'", "‛": "'", "“": "\"", "”": "\"", "„": "\"", "‟": "\"",
  "‐": "-", "‑": "-", "‒": "-", "–": "-", "—": "-", "―": "-", "−": "-", " ": " ",
};
const plain = (text: string) => {
  let out = "";
  for (const char of text.normalize("NFKC")) {
    const mapped = same_as[char] ?? char;
    if (mapped.trim() !== "") out += mapped.toLowerCase();
  }
  return out;
};

// The numbers a text states, as values: "1,200.5" and "1200.5" are the same figure.
export const numeric_tokens = (text: string) => (text.match(/(?<![\d.,])[-+]?(?:\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)(?!\d|[.,]\d)/gu) ?? [])
  .map(value => Number(value.replaceAll(",", "")));

// Every number in a sentence appears in the passage it cites: nothing computed, rounded or estimated.
export const numbers_stated_in = (text: string, passage: string) => {
  const stated = numeric_tokens(passage);
  return numeric_tokens(text).every(value => stated.includes(value));
};

export const quotes = (passage: string | undefined, excerpt: string) => !!passage && !!excerpt.trim() && plain(passage).includes(plain(excerpt));
