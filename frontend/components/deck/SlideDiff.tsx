import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { TProposal, TSlide } from "@/types/deck";
import { SlideTemplate } from "./SlideTemplate";
import { ConversionChart } from "./ConversionChart";

const sentenceSplitter = new Intl.Segmenter(undefined, { granularity: "sentence" });
const sentences = (slide: TSlide) => {
  const planned = slide.sentences?.map(sentence => sentence.text.trim());
  return (planned?.length && planned.join(" ") === slide.narration.trim().replace(/\s+/gu, " ") ? planned :
    [...sentenceSplitter.segment(slide.narration)].map(({ segment }) => segment.trim()).filter(Boolean))
    .map(sentence => sentence.normalize("NFKC"));
};

export const SlideDiff = ({ proposal, pending, live = false, onDecision }: {
  proposal: TProposal; pending: boolean; live?: boolean; onDecision: (decision: "approve" | "reject") => void;
}) => {
  const changedTemplate = JSON.stringify(proposal.before.template) !== JSON.stringify(proposal.after.template);
  const changedChart = JSON.stringify(proposal.before.chart) !== JSON.stringify(proposal.after.chart);
  const alreadySpoken = new Set(sentences(proposal.before));
  const addsNarration = sentences(proposal.after).some(sentence => !alreadySpoken.has(sentence));
  return <section aria-label="Private slide change"><Card className="shadow-none">
  <CardHeader>
    <h3 className="font-display text-2xl leading-tight">Review slide change</h3>
    {live && <p className="text-sm text-muted-foreground">{addsNarration ?
      "Applying shows the revised slide and plays the new narration before advancing." :
      "Applying shows the revised slide before advancing."}</p>}
  </CardHeader>
  <CardContent className="grid gap-4">
  <div className="deck-diff">{(["before", "after"] as const).map(side => <Card key={side} className={side === "after" ? "border-primary/50 bg-muted p-3" : "bg-background p-3"}>
    <h4 className="mb-2 font-semibold">{side === "before" ? "Current slide" : "Proposed slide"}</h4>
    <p>{proposal[side].title}</p>
    <ul className="list-disc space-y-1 pl-5">{proposal[side].highlights.map((point, i) => <li key={i}>{point}</li>)}</ul>
    {changedTemplate && <div className="mt-2 border-t border-border pt-2">{proposal[side].template ?
      <SlideTemplate template={proposal[side].template} /> : <p className="text-sm text-muted-foreground">No structured content</p>}</div>}
    {changedChart && <div className="mt-2 border-t border-border pt-2">{proposal[side].chart ?
      <ConversionChart chart={proposal[side].chart} /> : <p className="text-sm text-muted-foreground">No chart</p>}</div>}
    <Collapsible key={proposal.proposal_id} className="mt-3 border-t border-border pt-2" defaultOpen={proposal.before.narration !== proposal.after.narration}>
      <CollapsibleTrigger asChild>
        <Button type="button" size="sm" variant="ghost" className="group w-full justify-between px-1 hover:bg-card">
          Private narration<ChevronDown size={15} aria-hidden="true" className="motion-safe:transition-transform group-data-[state=open]:rotate-180" />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="whitespace-pre-wrap px-1 text-sm leading-relaxed">{proposal[side].narration}</CollapsibleContent>
    </Collapsible>
  </Card>)}</div>
  {!!proposal.attribution?.length && <ul className="space-y-1 text-sm text-muted-foreground">
    {proposal.attribution.map(({ evidence_id, excerpt }, i) => <li key={evidence_id + i}>{evidence_id === "host" ? "Host statement" : evidence_id} · {excerpt}</li>)}
  </ul>}
  <div className="flex flex-wrap gap-2">
    <Button disabled={pending} onClick={() => onDecision("approve")}>{live ? "Apply and continue" : "Approve revision"}</Button>
    <Button variant="outline" disabled={pending} onClick={() => onDecision("reject")}>{live ? "Keep current slide" : "Reject changes"}</Button>
  </div>
  </CardContent>
</Card></section>;
};
