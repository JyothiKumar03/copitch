import type { TConversionChart, TSlide } from "./deck";

export type TAudienceSlide = Pick<TSlide, "slide_id" | "layout" | "title" | "highlights" | "chart_period" | "template"> & {
  chart?: { period: TConversionChart["period"]; rows: Omit<TConversionChart["rows"][number], "evidence_id">[] };
};

export type TAudienceProjection = {
  sequence: number;
  revision: number;
  deck_title: string;
  index: number;
  total: number;
  slide: TAudienceSlide;
};
