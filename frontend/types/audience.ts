import type { TDeck, TDeckWorkspaceProps, TSlide } from "./deck";
import type { TResearchSession } from "./research";

export type TAudienceProjection = {
  sequence: number; revision: number; deck_title: string; index: number; total: number;
  slide: Pick<TSlide, "slide_id" | "layout" | "title" | "highlights" | "evidence_ids" | "chart">;
};
export type TRelease = { deck_id: string; revision: number; slide_id: string };
export type TAudienceOpen = { sequence: number; token: string; expires_at: number };
export type TAudienceProps = Pick<TDeckWorkspaceProps, "getSession"> & {
  deck: TDeck | null; slideId?: string; live: boolean;
};
export type TPublisher = {
  session: TResearchSession; release: TRelease; sequence: number;
};
