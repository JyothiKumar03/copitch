import Image from "next/image";
import Link from "next/link";
import { ArrowDown, ArrowRight, AudioLines, BookOpenText, ChevronDown, FilePenLine, ScanSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Separator } from "@/components/ui/separator";
import { SiteHeader } from "@/components/site/SiteHeader";
import { samplePitch } from "@/lib/sample-pitch";
import studioMicrophone from "@/public/studio/microphone.webp";
import { SamplePlayer } from "./SamplePlayer";

const workflow = [
  { icon: AudioLines, title: "Talk it through", description: "Speak or type your idea. The interviewer listens for your audience, your goal, and the decision you want from the room." },
  { icon: ScanSearch, title: "Research the evidence", description: "Review the scope and choose your sources. Approve the search, or keep the research to material you supply." },
  { icon: FilePenLine, title: "Build and present a deck", description: "Open the verified context, then prepare slides and review the narration before you present." },
];

const pageWidth = "mx-auto w-full max-w-360 px-5 sm:px-9 lg:px-[5.5%]";
const smallLabel = "text-xs font-semibold tracking-[0.12em] uppercase";

export const LandingPage = () => (
  <>
    <SiteHeader />
    <main>
      <section aria-labelledby="hero-title" className={pageWidth}>
        <div className="grid items-center gap-9 py-12 sm:py-16 md:grid-cols-[1.02fr_1fr] md:gap-7 lg:min-h-[calc(100svh-4.5rem)] lg:gap-16 lg:py-17">
          <div className="min-w-0">
            <h1 id="hero-title" className="font-display text-[clamp(2.8rem,5.5vw,5.6rem)] font-normal leading-[0.99] tracking-[-0.056em]">
              An AI presenter<br/><em className="font-normal text-primary">you brief by voice.</em>
            </h1>
            <p className="mt-5 max-w-[42ch] text-[1.08rem] leading-[1.55] text-muted-foreground sm:text-xl">
              Tell copitch who’s listening and what matters to them. Turn your files, links, and approved research into a deck you can review and present.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-3 sm:mt-9">
              <Button asChild size="lg"><Link href="/research">Start a session <ArrowRight aria-hidden="true" size={17}/></Link></Button>
              <Button asChild variant="link" className="px-0"><a href="#sample">Read a sample <ArrowDown aria-hidden="true" size={15}/></a></Button>
            </div>
          </div>
          <figure className="group min-w-0 overflow-hidden rounded-xl border border-border bg-muted shadow-sm">
            <div className="relative aspect-[1.4] overflow-hidden md:aspect-[1.22] lg:aspect-[1.39]">
              <Image src={studioMicrophone} alt="A silver microphone resting on speaker notes on a studio desk." fill preload sizes="(max-width: 767px) 92vw, 45vw" className="object-cover motion-safe:transition-transform motion-safe:duration-500 motion-safe:group-hover:scale-[1.025]"/>
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
          <article aria-label="Sample speaking notes">
            <Card className="py-0 shadow-sm">
              <CardContent className="p-6 sm:p-9">
                <h3 className={`pb-4 text-muted-foreground ${smallLabel}`}>Speaking notes</h3>
                <Separator />
                <p className="mt-5 font-display text-[1.8rem] leading-tight tracking-tight">{samplePitch.opening}</p>
                <p className="mt-3 leading-relaxed">{samplePitch.evidence} {samplePitch.closing}</p>
                <Collapsible className="mt-5 border-t border-border pt-2.5 text-sm">
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" className="group w-full justify-between px-0 text-primary hover:bg-transparent hover:text-primary hover:underline">
                      View the sample evidence <ChevronDown aria-hidden="true" className="size-4 transition-transform group-data-[state=open]:rotate-180 motion-reduce:transition-none" />
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <p className="mt-1 leading-relaxed text-muted-foreground">Illustrative trial data. Enterprise had 4 conversions from 20 trials (20%). Small business had 6 from 80 (7.5%). Overall conversion was 10%. The sample doesn’t establish what caused the difference.</p>
                  </CollapsibleContent>
                </Collapsible>
              </CardContent>
            </Card>
          </article>
        </div>
      </section>
      <section aria-labelledby="live-title" className="bg-studio-dark text-studio-light">
        <div className={`${pageWidth} grid gap-4 py-10 sm:grid-cols-2 sm:gap-12 lg:py-14`}>
          <h2 id="live-title" className="font-display text-4xl leading-tight tracking-tight sm:text-5xl">Presenting live</h2>
          <p className="max-w-prose self-center text-lg leading-relaxed">Open a separate audience screen. Interrupt to ask a question, review a proposed edit, or resume from the same sentence.</p>
        </div>
      </section>
    </main>
    <footer className="border-t border-border"><div className={`${pageWidth} flex items-center justify-between gap-4 py-6 text-sm`}><Link href="/" className="font-display text-2xl tracking-tight">copitch</Link><Link href="/research" className="inline-flex min-h-10 items-center gap-2 font-semibold text-primary hover:underline">Open pitch studio <ArrowRight size={15} aria-hidden="true"/></Link></div></footer>
  </>
);
