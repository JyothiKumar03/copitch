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

export const quotes = (passage: string | undefined, excerpt: string) => !!passage && !!excerpt.trim() && plain(passage).includes(plain(excerpt));
