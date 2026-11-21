import { ConversionChart } from "./ConversionChart";
import { SlideTemplate } from "./SlideTemplate";
import { stageStyle, slideDensity } from "@/lib/stage-style";
import type { TDeck, TSlide, TSlideView } from "@/types/deck";

export const deckSlideView = (deck: TDeck, slide: TSlide, index: number): TSlideView => {
  const { slide_id, layout, title, highlights, evidence_ids, chart, template } = slide;
  return { deckTitle: deck.title, index, total: deck.slides.length, slide: { slide_id, layout, title, highlights, evidence_ids, chart, template } };
};

export const PublicSlide = ({ view, className = "" }: { view: TSlideView; className?: string }) => {
  const { deckTitle, slide, index, total } = view;
  return (
    <section className={`slide-shell ${className}`} data-layout={slide.layout} data-density={slideDensity(slide.title, slide.highlights)}
      aria-label={`Slide ${index + 1} of ${total}`}>
      <div className="slide-top"><span>{deckTitle}</span><span>{index + 1} / {total}</span></div>
      <h3>{slide.title}</h3>
      {slide.highlights.length > 0 && <ul>{slide.highlights.map((item, i) => <li key={i}>{item}</li>)}</ul>}
      {slide.template && <SlideTemplate template={slide.template} />}
      {slide.chart && <ConversionChart chart={slide.chart} />}
      {!!slide.evidence_ids.length && <footer>Sources · {slide.evidence_ids.join(", ")}</footer>}
    </section>
  );
};

export const Slide = ({ deck, slide, index }: { deck: TDeck; slide: TSlide; index: number }) =>
  <><style>{stageStyle}</style><PublicSlide view={deckSlideView(deck, slide, index)} /></>;
