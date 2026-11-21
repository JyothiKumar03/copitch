import Link from "next/link";
import { ArrowDown, ArrowRight, AudioLines, FileText, Globe2, PanelsTopLeft, Presentation } from "lucide-react";
import { PublicSlide } from "@/components/deck/Slide";
import { SiteHeader } from "@/components/site/SiteHeader";
import { Button } from "@/components/ui/button";
import { samplePitch } from "@/lib/sample-pitch";
import { stageStyle } from "@/lib/stage-style";
import type { TSlideView } from "@/types/deck";
import { SamplePlayer } from "./SamplePlayer";

const sampleSlide: TSlideView = {
  deckTitle: samplePitch.title,
  index: 0,
  total: 1,
  slide: {
    slide_id: "sample-onboarding",
    layout: "evidence",
    title: "Enterprise trials converted at twice the overall rate",
    highlights: [],
    evidence_ids: [],
    template: { type: "bar_chart", unit: "Trial conversion, %", points: [{ label: "Enterprise", value: 20 }, { label: "Overall", value: 10 }] },
  },
};

const workflow = [
  { icon: AudioLines, title: "Brief the agent", description: "Brief by voice or chat. Add files and links as you go." },
  { icon: Globe2, title: "Review the research", description: "Approve the research scope and check the citations." },
  { icon: Presentation, title: "Present your deck", description: "Review your slides and interrupt the presenter live." },
];

export const LandingPage = () => (
  <>
    <SiteHeader />
    <main>
      <section id="hero" aria-labelledby="hero-title" className="hero grid min-h-svh items-center bg-background bg-[radial-gradient(ellipse_at_76%_52%,var(--hero-glow),transparent_65%)] pb-8 pt-24 sm:pb-14 sm:pt-28">
        <div className="wrap site-wrap grid items-center gap-8 lg:grid-cols-12 lg:gap-6">
          <div className="lg:col-span-5">
            <h1 id="hero-title" className="max-w-[10ch] text-[clamp(3.5rem,7.3vw,7.25rem)] font-semibold leading-[.89] tracking-[-.085em] text-balance">
              The AI <span className="text-primary">pitch studio.</span>
            </h1>
            <p className="mt-5 max-w-[36ch] text-lg leading-snug text-pretty text-muted-foreground sm:mt-7 sm:text-xl">
              Start with a conversation. Build a source-backed deck and present it with an agent you can interrupt live.
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-2 sm:mt-8 sm:gap-3">
              <Button asChild size="lg"><Link href="/research">Open studio <ArrowRight aria-hidden="true" size={17} /></Link></Button>
              <Button asChild variant="ghost" size="lg"><a href="#sample">Explore a sample <ArrowDown aria-hidden="true" size={16} /></a></Button>
            </div>
          </div>
          <div className="app-frame overflow-hidden rounded-xl border border-input bg-card shadow-[0_30px_80px_-43px_#000] lg:col-span-7" aria-label="Example presentation in copitch">
            <div className="flex min-h-12 flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3 py-2 text-xs sm:px-4 sm:text-sm">
              <div className="flex min-w-0 items-center gap-2 font-semibold"><PanelsTopLeft aria-hidden="true" className="size-4 shrink-0 text-primary" /> Presentation preview</div>
              <span className="text-muted-foreground">Example project</span>
            </div>
            <div data-ui="presentation-preview" className="mx-2.5 overflow-hidden rounded-md ring-1 ring-border [container-type:inline-size] sm:mx-4">
              <style>{stageStyle}</style>
              <PublicSlide view={sampleSlide} embedded />
            </div>
            <SamplePlayer />
          </div>
        </div>
      </section>

      <section id="workflow" aria-labelledby="workflow-title" className="grid min-h-svh items-center bg-card py-7 sm:py-11 lg:py-16">
        <div className="wrap site-wrap grid gap-4 sm:gap-8 lg:gap-10">
          <h2 id="workflow-title" className="max-w-[21ch] text-[clamp(2.4rem,5.5vw,5rem)] font-semibold leading-[.94] tracking-[-.075em] text-balance">From idea to live delivery</h2>
          <div className="grid items-start gap-4 sm:gap-6 lg:grid-cols-12">
            <ol className="grid content-start divide-y divide-border border-y border-border lg:col-span-5">
              {workflow.map(({icon: Icon, title, description}) => (
                <li key={title} className="flex items-start gap-3 py-3 first:pt-2 sm:gap-5 sm:py-5 sm:first:pt-3">
                  <Icon aria-hidden="true" className="mt-1 size-5 shrink-0 text-primary" strokeWidth={1.7} />
                  <div><h3 className="text-lg font-semibold tracking-[-.035em] sm:text-xl">{title}</h3>
                    <p className="max-w-[39ch] text-sm leading-snug text-pretty text-muted-foreground sm:mt-1 sm:text-base">{description}</p></div>
                </li>
              ))}
            </ol>
            <article id="sample" data-ui="speaking-notes" className="app-frame scroll-mt-4 overflow-hidden rounded-xl border border-input bg-stage lg:col-span-7" aria-labelledby="sample-title">
              <div className="flex items-center gap-2 px-4 py-3 text-sm font-semibold sm:px-5"><FileText className="size-4 text-evidence" aria-hidden="true" /> Example speaking notes</div>
              <div className="min-w-0 bg-document px-4 py-4 text-document-foreground sm:px-8 sm:py-8">
                <h3 id="sample-title" className="max-w-[20ch] font-document text-[clamp(1.75rem,4.1vw,3.75rem)] leading-[.98] tracking-[-.05em]">{samplePitch.title}</h3>
                <p className="mt-3 text-sm leading-snug sm:mt-5 sm:text-lg sm:leading-relaxed">{samplePitch.opening} {samplePitch.evidence}</p>
                <p className="mt-2 text-sm leading-snug sm:mt-3 sm:text-lg sm:leading-relaxed">{samplePitch.closing}</p>
                <div className="mt-3 border-t border-document-foreground/20 pt-2 text-xs font-medium sm:mt-6 sm:pt-3 sm:text-sm">Illustrative trial data · 4 of 20 enterprise trials and 10 of 100 overall converted.</div>
              </div>
            </article>
          </div>
          <div><Button asChild size="lg"><Link href="/research">Open studio <ArrowRight size={17} aria-hidden="true" /></Link></Button></div>
        </div>
      </section>
    </main>
  </>
);
