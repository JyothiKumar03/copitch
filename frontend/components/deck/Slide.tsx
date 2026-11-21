import { ConversionChart } from "./ConversionChart";
import { SlideTemplate } from "./SlideTemplate";
import { stageStyle, slideDensity } from "../../lib/stage-style";
import type { TDeck, TSlide, TSlideView } from "@/types/deck";

// The audience sees where a slide's facts come from as site or file names. Host notes stay private.
export const sourceLabels = (deck: TDeck, evidenceIds: string[]) => [...new Set(evidenceIds.flatMap(id => {
  const source = deck.sources?.find(item => item.id === id);
  if (!source || source.origin === "host") return [];
  if (source.url) { try { return [new URL(source.url).hostname.replace(/^www\./u, "")]; } catch { return []; } }
  return [source.location.split(",")[0].trim()];
}))].slice(0, 3);

export const deckSlideView = (deck: TDeck, slide: TSlide, index: number): TSlideView => {
  const { slide_id, layout, title, highlights, evidence_ids, chart, chart_period, template } = slide;
  return { deckTitle: deck.title, index, total: deck.slides.length, sources: sourceLabels(deck, evidence_ids),
    slide: { slide_id, layout, title, highlights, evidence_ids, chart, chart_period, template } };
};

export const PublicSlide = ({ view, className = "" }: { view: TSlideView; className?: string }) => {
  const { deckTitle, slide, index, total, sources = [] } = view;
  const hasPoints = slide.highlights.length > 0;
  const hasVisual = !!slide.chart || !!slide.template && !["title_card", "bullet_slide"].includes(slide.template.type);
  const composition = hasVisual ? (hasPoints ? "mixed" : "visual") : (hasPoints ? "points" : "title");
  const chartRows = slide.template && "points" in slide.template ? slide.template.points.length : slide.chart?.rows.length;
  return (
    <section className={`slide-shell ${className}`} data-layout={slide.layout} data-density={slideDensity(slide.title, slide.highlights, chartRows)}
      data-composition={composition} data-template={slide.template?.type ?? "bullet_slide"} aria-label={`Slide ${index + 1} of ${total}`}>
      <div className="slide-top"><span>{deckTitle}</span><span>{index + 1} / {total}</span></div>
      <h3>{slide.title}</h3>
      {(hasPoints || hasVisual) && <div className="slide-content">
        {hasPoints && <ul className="slide-points" role="list">{slide.highlights.map((item, i) => <li key={i}>{item}</li>)}</ul>}
        {hasVisual && <div className="slide-visual">
          {slide.template && <SlideTemplate template={slide.template} period={slide.chart_period} />}
          {slide.chart && <ConversionChart chart={slide.chart} />}
        </div>}
      </div>}
      {!!sources.length && <footer>Source: {sources.join(" · ")}</footer>}
    </section>
  );
};

export const Slide = ({ deck, slide, index }: { deck: TDeck; slide: TSlide; index: number }) =>
  <><style>{stageStyle}</style><PublicSlide view={deckSlideView(deck, slide, index)} /></>;
