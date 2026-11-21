import type { TPublicSlide } from "./deck";

export type TAudienceProjection = {
  sequence: number; revision: number; deck_title: string; index: number; total: number;
  slide: TPublicSlide;
};
export type TAudienceOpen = { sequence: number; token: string; expires_at: number };
