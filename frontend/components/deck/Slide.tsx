import { ConversionChart } from "./ConversionChart";
import { slideSource } from "@/lib/slide-source";
import { Fragment } from "react";
import { stageStyle, slideDensity } from "@/lib/stage-style";
import type { TDeck, TSlide } from "@/types/deck";

export const Slide = ({ deck, slide, index }: { deck: TDeck; slide: TSlide; index: number }) => {
  return (
    <section className="slide-shell" data-layout={slide.layout} data-density={slideDensity(slide.title, slide.highlights)} aria-label={`Slide ${index + 1} of ${deck.slides.length}`}>
      <style>{stageStyle}</style>
      <div className="slide-top"><span>{deck.title}</span><span>{String(index + 1).padStart(2, "0")} / {String(deck.slides.length).padStart(2, "0")}</span></div>
      <h3>{slide.title}</h3>
      {slide.highlights.length > 0 && <ul>{slide.highlights.map((item, i) => <li key={i}>{item}</li>)}</ul>}
      {slide.chart && <ConversionChart chart={slide.chart} />}
      {!!slide.evidence_ids.length && <footer>Sources · {slide.evidence_ids.map((id, i) => {
        const source = slideSource(deck, id);
        return <Fragment key={id}>{i > 0 && ", "}{source.href
          ? <a href={source.href} target="_blank" rel="noreferrer" className="underline">{source.label}</a> : source.label}</Fragment>;
      })}</footer>}
    </section>
  );
};
