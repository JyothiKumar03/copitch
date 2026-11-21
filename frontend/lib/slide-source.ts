import type { TDeck } from "@/types/deck";

export const slideSource = (deck: TDeck, id: string) => {
  const source = deck.sources?.find(item => item.id === id);
  if (!source) return { label: id };
  if (source.origin !== "public") return { label: `${id} · Host-provided source` };
  try {
    const url = new URL(source.url ?? "");
    if (url.protocol === "https:" || url.protocol === "http:") {
      if (!url.username && !url.password) return { label: `${id} · ${url.hostname}`, href: url.href };
    }
  } catch { /* Keep a text reference for a source without a public URL. */ }
  return { label: id };
};
