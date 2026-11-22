import { ConversionChart } from "./ConversionChart";
import { SlideTemplate } from "./SlideTemplate";
import { stageStyle, slideDensity } from "../../lib/stage-style";
import type { TDeck, TSlide, TSlideView } from "@/types/deck";
import { publicSourceLabels } from "../../../shared/presentation";
import { apiBase } from "../../lib/research";

const capturedImage = (deck: TDeck, evidenceIds: string[]) => {
  const path = evidenceIds.map(id => deck.sources?.find(source => source.id === id)?.image).find(Boolean);
  const approved = /^\/api\/sessions\/[\w-]+\/(?:website-walkthroughs\/[\w-]+\/screenshots\/\d+|site-runs\/[\w-]+\/steps\/\d+\/screenshot)$/u;
  return path && approved.test(path) ? apiBase + path : undefined;
};

export const deckSlideView = (deck: TDeck, slide: TSlide, index: number): TSlideView => {
  const { slide_id, layout, title, highlights, evidence_ids, chart, chart_period, template } = slide;
  const image = capturedImage(deck, evidence_ids);
  return { deckTitle: deck.title, index, total: deck.slides.length, sources: publicSourceLabels(deck.sources, evidence_ids), ...(image && { image }),
    slide: { slide_id, layout, title, highlights, evidence_ids, chart, chart_period, template } };
};

export const PublicSlide = ({ view, className = "", embedded = false }: { view: TSlideView; className?: string; embedded?: boolean }) => {
  const { deckTitle, slide, index, total, sources = [], image } = view;
  const hasPoints = slide.highlights.length > 0;
  const hasChart = !!slide.chart || !!slide.template && !["title_card", "bullet_slide"].includes(slide.template.type);
  // A captured page screenshot fills the visual column only when the slide has no chart or structured template.
  const screenshot = !hasChart && slide.template?.type !== "title_card" ? image : undefined;
  const hasVisual = hasChart || !!screenshot;
  const composition = hasVisual ? (hasPoints ? "mixed" : "visual") : (hasPoints ? "points" : "title");
  const Frame = embedded ? "div" : "section";
  const chartRows = slide.template && "points" in slide.template ? slide.template.points.length : slide.chart?.rows.length;
  return (
    <Frame role={embedded ? "region" : undefined} className={`slide-shell ${className}`} data-layout={slide.layout} data-density={slideDensity(slide.title, slide.highlights, chartRows)}
      data-composition={composition} data-template={slide.template?.type ?? "bullet_slide"} aria-label={`Slide ${index + 1} of ${total}`}>
      <div className="slide-top"><span>{deckTitle}</span><span>{index + 1} / {total}</span></div>
      <h3>{slide.title}</h3>
      {(hasPoints || hasVisual) && <div className="slide-content">
        {hasPoints && <ul className="slide-points" role="list">{slide.highlights.map((item, i) => <li key={i}>{item}</li>)}</ul>}
        {hasVisual && <div className="slide-visual">
          {slide.template && <SlideTemplate template={slide.template} period={slide.chart_period} />}
          {slide.chart && <ConversionChart chart={slide.chart} />}
          {/* eslint-disable-next-line @next/next/no-img-element -- authenticated API image inside the slide stage */}
          {screenshot && <img className="slide-screenshot" src={screenshot} alt="" />}
        </div>}
      </div>}
      {!!sources.length && <footer>Source: {sources.join(" · ")}</footer>}
    </Frame>
  );
};

export const Slide = ({ deck, slide, index }: { deck: TDeck; slide: TSlide; index: number }) =>
  <><style>{stageStyle}</style><PublicSlide view={deckSlideView(deck, slide, index)} /></>;
