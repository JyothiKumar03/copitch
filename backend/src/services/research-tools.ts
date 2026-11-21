import { read_host_page, research_link, research_url } from "./host-pages";
import type { TResearchLink } from "./host-pages";
import type { TResearchBrief, TResearchProvider } from "../types/research";

export type { TPageDiscovery, TResearchLink } from "./host-pages";

export const create_research_sources = (
  brief: Pick<TResearchBrief, "source_policy" | "urls" | "public_queries">,
  lookup: TResearchProvider["lookup"],
  read = read_host_page,
) => {
  const roots = new Set(brief.urls.flatMap(url => research_url(url) ?? []));
  const check_network = (signal: AbortSignal) => {
    signal.throwIfAborted();
    if (brief.source_policy !== "public_search") throw new Error("Files-only research cannot use external sources.");
  };

  return {
    read_page: async (value: string, known_links: readonly string[], signal: AbortSignal) => {
      check_network(signal);
      const url = research_url(value);
      if (!url || (!roots.has(url) && !known_links.includes(url))) {
        throw new Error("Choose a host-approved page or a link already returned by a research tool.");
      }
      // Research reads include long statistical PDFs, which need longer than an ordinary page.
      return read(url, signal, { try_www: roots.has(url), timeout_ms: 35_000 });
    },
    search_web: async (value: string, parent: AbortSignal) => {
      check_network(parent);
      // The host approved public search for this brief. The agent writes and rewrites its own queries within that scope.
      const query = value.trim().slice(0, 200);
      if (query.length < 3) throw new Error("Write a search query.");
      const signal = AbortSignal.any([parent, AbortSignal.timeout(20_000)]);
      const hits = await lookup(query, undefined, signal, undefined, "discovery");
      signal.throwIfAborted();
      const links = new Map<string, TResearchLink>();
      for (const hit of hits) {
        const link = research_link(hit.url, hit.title);
        if (link && !links.has(link.url)) links.set(link.url, link);
      }
      return [...links.values()].slice(0, 8);
    },
  };
};
