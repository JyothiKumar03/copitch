import Image from "next/image";
import Link from "next/link";
import { ArrowDown, ArrowRight, AudioLines, BookOpenText, FilePenLine, ScanSearch } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { SiteHeader } from "@/components/site/SiteHeader";
import { samplePitch } from "@/lib/sample-pitch";
import studioMicrophone from "@/public/studio/microphone.webp";
import { SamplePlayer } from "./SamplePlayer";

const workflow = [
  { icon: AudioLines, title: "Talk it through", description: "Speak or type your idea. The interviewer listens for your audience, your goal, and the decision you want from the room." },
  { icon: ScanSearch, title: "Research the evidence", description: "Review the scope and choose your sources. Approve the search, or keep the research to material you supply." },
  { icon: FilePenLine, title: "Shape the pitch", description: "Copy a speaking script or prepare slides. When the evidence is too thin for a full pitch, review the supported points and what’s missing." },
];

const pageWidth = "mx-auto w-full max-w-360 px-5 sm:px-9 lg:px-[5.5%]";
const smallLabel = "text-xs font-semibold tracking-[0.12em] uppercase";

export const LandingPage = () => (
  <>
    <SiteHeader />
    <main>
      <section aria-labelledby="hero-title" className={pageWidth}>
        <div className="grid items-center gap-9 py-10 sm:py-14 md:grid-cols-[1.02fr_1fr] md:gap-7 lg:gap-16 lg:py-17">
          <div className="min-w-0">
            <p className={`mb-5 flex items-center gap-2.5 text-primary ${smallLabel}`}><span aria-hidden="true" className="h-px w-7 bg-primary"/>Pitch preparation</p>
            <h1 id="hero-title" className="font-display text-[clamp(2.8rem,5.5vw,5.6rem)] font-normal leading-[0.99] tracking-[-0.056em]">
              An AI presenter<br/><em className="font-normal text-primary">you brief by voice.</em>
            </h1>
            <p className="mt-5 max-w-[42ch] text-[1.08rem] leading-[1.55] text-muted-foreground sm:text-xl">
              Tell copitch who’s listening, what matters to them, and what they should take away. It turns your files, links, and approved research into a pitch and deck.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-3 sm:mt-9">
              <Link href="/research" className={buttonVariants({size:"lg"})}>Start a session <ArrowRight aria-hidden="true" size={17}/></Link>
              <a href="#sample" className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold underline decoration-border underline-offset-[5px] hover:decoration-foreground">Read a sample <ArrowDown aria-hidden="true" size={15}/></a>
            </div>
          </div>
          <figure className="min-w-0 overflow-hidden rounded-[3px] bg-muted">
            <div className="relative aspect-[1.4] md:aspect-[1.22] lg:aspect-[1.39]">
              <Image src={studioMicrophone} alt="A silver microphone resting on speaker notes on an studio desk." fill preload sizes="(max-width: 767px) 92vw, 45vw" className="object-cover"/>
            </div>
            <SamplePlayer />
          </figure>
        </div>
      </section>

      <section id="workflow" aria-labelledby="workflow-title" className={pageWidth}>
        <div className="border-y border-border pb-10 pt-8 lg:pb-14 lg:pt-10">
          <h2 id="workflow-title" className="font-display text-[clamp(2.35rem,3.8vw,4.2rem)] font-normal leading-tight tracking-[-0.045em]">How it works</h2>
          <div className="mt-5 grid gap-x-7 gap-y-6 sm:grid-cols-3 lg:mt-7 lg:gap-12">
            {workflow.map(({icon: Icon, title, description}) => (
              <div key={title} className="border-l border-border pl-4 sm:pl-5">
                <Icon aria-hidden="true" className="mb-3 size-6 text-primary" strokeWidth={1.5}/>
                <h3 className="font-display text-[1.7rem] leading-tight tracking-tight">{title}</h3>
                <p className="mt-2 max-w-prose text-[0.98rem] leading-relaxed text-muted-foreground">{description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="sample" aria-labelledby="sample-title" className={pageWidth}>
        <div className="grid items-start gap-7 py-12 md:grid-cols-[0.85fr_1.35fr] md:gap-12 lg:py-19">
          <div>
            <p className={`mb-4 flex items-center gap-2 text-primary ${smallLabel}`}><BookOpenText size={17} aria-hidden="true"/>Example session</p>
            <h2 id="sample-title" className="max-w-[13ch] font-display text-[clamp(2.7rem,4.2vw,4.8rem)] font-normal leading-[1.02] tracking-[-0.045em]">{samplePitch.title}</h2>
            <p className="mt-4 max-w-[38ch] leading-relaxed text-muted-foreground">A sample brief for a growth team deciding where to test guided onboarding.</p>
          </div>
          <article aria-label="Sample speaking notes" className="border border-border bg-card p-6 sm:p-9">
            <h3 className={`border-b border-border pb-4 text-muted-foreground ${smallLabel}`}>Speaking notes</h3>
            <p className="mt-5 font-display text-[1.8rem] leading-tight tracking-tight">{samplePitch.opening}</p>
            <p className="mt-3 leading-relaxed">{samplePitch.evidence} {samplePitch.closing}</p>
            <details className="group mt-5 border-t border-border pt-3.5 text-sm">
              <summary className="flex min-h-10 list-none items-center justify-between gap-3 font-semibold text-primary [&::-webkit-details-marker]:hidden">View the sample evidence <span aria-hidden="true" className="text-lg group-open:hidden">+</span><span aria-hidden="true" className="hidden text-lg group-open:inline">−</span></summary>
              <p className="mt-1 leading-relaxed text-muted-foreground">Illustrative trial data. Enterprise had 4 conversions from 20 trials (20%). Small business had 6 from 80 (7.5%). Overall conversion was 10%. The sample doesn’t establish what caused the difference.</p>
            </details>
          </article>
        </div>
      </section>
      <section aria-labelledby="live-title" className="bg-studio-dark text-studio-light">
        <div className={`${pageWidth} grid gap-4 py-10 sm:grid-cols-2 sm:gap-12 lg:py-14`}>
          <div><p className={`${smallLabel} mb-3 text-studio-light/80`}>In development</p>
            <h2 id="live-title" className="font-display text-4xl leading-tight tracking-tight sm:text-5xl">Presenting live</h2></div>
          <p className="max-w-prose self-center text-lg leading-relaxed">The next part of copitch is an agent that presents with you. Jump in with a personal story, steer the pitch, or ask it to walk the audience through your website.</p>
        </div>
      </section>
    </main>
    <footer className="border-t border-border"><div className={`${pageWidth} flex items-center justify-between gap-4 py-6 text-sm`}><Link href="/" className="font-display text-2xl tracking-tight">copitch</Link><Link href="/research" className="inline-flex min-h-10 items-center gap-2 font-semibold text-primary hover:underline">Open pitch studio <ArrowRight size={15} aria-hidden="true"/></Link></div></footer>
  </>
);
