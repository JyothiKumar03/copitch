import { read_host_page, research_link, research_url } from "./host-pages";
import type { TResearchLink } from "./host-pages";
import type { TEvidence, TResearchBrief, TResearchProvider } from "../types/research";
import type { TCollectResearch } from "../types/research-agent";

export type { TPageDiscovery, TResearchLink } from "./host-pages";

type TSourceBrief = Pick<TResearchBrief, "source_policy" | "urls" | "public_queries">
  & Partial<Pick<TResearchBrief, "messages" | "studio_notes" | "materials" | "history">>;

export const public_query_rejected = "Rephrase the public search using public facts only and leave out private notes or identifiers.";
const normalized = (text: string) => text.normalize("NFKC").toLowerCase();
const words = (text: string) => normalized(text).match(/[\p{L}\p{N}\p{M}]+/gu) ?? [];

const public_query_guard = (brief: TSourceBrief, evidence: readonly TEvidence[]) => {
  const private_sources = [brief.materials ?? "", ...(brief.studio_notes ?? []),
    ...evidence.filter(item => item.origin !== "public").flatMap(item => [item.location, item.passage])];
  const host_turns = [...(brief.messages ?? []), ...(brief.history ?? []).flatMap(turn => turn.role === "host" ? [turn.text] : [])];
  const literal_text = [...private_sources, ...host_turns].map(normalized).join("\0");
  const searchable_text = private_sources.map(input => ` ${words(input).join(" ")} `).join("\0");
  const approved_queries = brief.public_queries.map(query => ` ${words(query).join(" ")} `);

  return (query: string) => {
    const value = normalized(query);
    const identifiers = value.match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}|[a-z0-9]+(?:[_-][a-z0-9]+){2,}/g) ?? [];
    if (identifiers.some(token => token.length >= 12 && literal_text.includes(token))) throw new Error(public_query_rejected);
    // Catch verbatim material without disallowing ordinary public question terms shared with a brief.
    const terms = words(value);
    for (let start = 0; start + 6 <= terms.length; start++) {
      const phrase = ` ${terms.slice(start, start + 6).join(" ")} `;
      if (phrase.length >= 34 && searchable_text.includes(phrase) && !approved_queries.some(query => query.includes(phrase))) {
        throw new Error(public_query_rejected);
      }
    }
  };
};

export const create_research_sources = (
  brief: TSourceBrief,
  lookup: TResearchProvider["lookup"],
  read = read_host_page,
  evidence: readonly TEvidence[] = [],
) => {
  const roots = new Set(brief.urls.flatMap(url => research_url(url) ?? []));
  const check_public_query = public_query_guard(brief, evidence);
  const check_network = (signal: AbortSignal) => {
    signal.throwIfAborted();
    if (brief.source_policy !== "public_search") throw new Error("Files-only research cannot use external sources.");
  };

  return {
    check_public_query,
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
      const query = value.trim().slice(0, 200);
      if (query.length < 3) throw new Error("Write a search query.");
      check_public_query(query);
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

export const research_discovery_lookup = (discovery: ReturnType<typeof create_research_sources>): TCollectResearch["lookup"] =>
  async ({ kind, target, known_links }, signal) => {
    if (kind === "read") {
      const page = await discovery.read_page(target, known_links, signal);
      return { url: page.url, hits: page.hits, links: page.links.map(link => ({ url: link.url, title: link.label })) };
    }
    const links = await discovery.search_web(target, signal);
    return { hits: [], links: links.map(link => ({ url: link.url, title: link.label })) };
  };
