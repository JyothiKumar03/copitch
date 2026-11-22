import type { TDeck } from "@/types/deck";

// Host-facing label for one slide source: the page it came from, linked when it is a public web page.
export const slideSource = (deck: TDeck, id: string) => {
  const source = deck.sources?.find(item => item.id === id);
  if (!source) return { label: "Source unavailable" };
  try {
    const url = new URL(source.url ?? "");
    if ((url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password) {
      const page = url.hostname.replace(/^www\./u, "") + (url.pathname === "/" ? "" : url.pathname);
      return { label: source.origin === "public" ? `${source.location} · ${page}` : page, href: url.href };
    }
  } catch { /* A source without a public URL keeps a text reference. */ }
  return { label: source.origin === "material" ? "Your uploaded material" : "Your notes in this project" };
};

export const slideSources = (deck: TDeck, ids: string[]) =>
  [...new Map(ids.map(id => slideSource(deck, id)).map(source => [source.label, source])).values()];
