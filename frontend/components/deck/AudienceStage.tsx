"use client";

import { ConversionChart } from "./ConversionChart";
import { useAudienceView } from "@/hooks/deck/use-audience";
import { slideDensity, stageStyle } from "@/lib/stage-style";

export const AudienceStage = () => {
  const { token, view } = useAudienceView();
  if (!token || view.error || !view.data) {
    const message = !token ? "Open the audience link shared by your presenter." : view.error?.message ?? "Connecting to the presentation…";
    return <main className="grid min-h-dvh place-items-center bg-background px-6 py-12 text-foreground">
      <section className="w-full max-w-lg border-y border-border py-10 sm:py-14">
        <h1 className="mb-4 font-display text-4xl tracking-tight sm:text-5xl">Audience screen</h1>
        <p role="status" className="leading-relaxed text-muted-foreground">{message}</p>
      </section>
    </main>;
  }
  const { deck_title, slide, index, total } = view.data;
  return <main className="min-h-dvh bg-background p-2 sm:p-4">
    <style>{stageStyle}</style>
    <section className="slide-shell" style={{ minHeight: "calc(100dvh - 2rem)" }} data-layout={slide.layout}
      data-density={slideDensity(slide.title, slide.highlights)} aria-label={`Slide ${index + 1} of ${total}`}>
      <div className="slide-top"><span>{deck_title}</span><span>{index + 1} / {total}</span></div>
      <h3>{slide.title}</h3>
      {!!slide.highlights.length && <ul>{slide.highlights.map((line, i) => <li key={i}>{line}</li>)}</ul>}
      {slide.chart && <ConversionChart chart={slide.chart} />}
      {!!slide.evidence_ids.length && <footer>Sources · {slide.evidence_ids.join(", ")}</footer>}
    </section>
  </main>;
};
