import type { TSlide } from "./deck";

export type TAudienceProjection = {
  sequence: number;
  revision: number;
  deck_title: string;
  index: number;
  total: number;
  slide: Pick<TSlide, "slide_id" | "layout" | "title" | "highlights" | "evidence_ids" | "chart" | "template">;
};
