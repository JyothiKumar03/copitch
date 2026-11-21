"use client";

import { PublicSlide } from "./Slide";
import { useAudienceView } from "@/hooks/deck/use-audience";
import { useStagePaint } from "@/hooks/deck/use-stage-paint";
import { stageStyle } from "@/lib/stage-style";

export const AudienceStage = () => {
  const { token, view } = useAudienceView();
  const frame = view.data;
  useStagePaint(token, frame && !view.error ? { sequence: frame.sequence, revision: frame.revision, slide_id: frame.slide.slide_id } : undefined);
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
    <PublicSlide className="audience-slide" view={{ deckTitle: deck_title, slide, index, total }} />
  </main>;
};
