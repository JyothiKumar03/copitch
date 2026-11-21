import { Check, ChevronDown, CircleAlert, FileText, LoaderCircle, Minus, Workflow } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { TResearchJob, TSourceCall, TTurnActivity } from "@/types/research";

const attentionKinds = new Set(["failed", "needs_input", "lookup_failed", "lookup_empty", "verification_skipped", "fallback", "superseded"]);
const informationKinds = new Set(["queued", "started", "resumed", "lookup_requested", "draft_started", "verification_started"]);
const statusNames: Record<TResearchJob["status"], string> = {
  queued: "Queued", running: "In progress", completed: "Complete", failed: "Failed", needs_input: "Needs input", superseded: "Replaced",
};
const parseNames = {parse_pdf: "Read PDF", parse_ppt: "Read PowerPoint", parse_pptx: "Read PowerPoint", parse_csv: "Read spreadsheet"};

export const SourceExecution = ({ call }: { call: TSourceCall }) => {
  const parsed = call.source?.locations;
  const status = call.status === "succeeded" ? "Read" : call.status === "failed" ? "Failed" : "Reading";
  const Icon = call.status === "failed" ? CircleAlert : call.status === "running" ? LoaderCircle : Check;
  return <div className="tool-event" data-status={call.status} aria-label={parseNames[call.tool]}>
    <span className="tool-icon"><FileText size={15} /></span>
    <div className="min-w-0"><p className="tool-title">{call.filename}</p>
      <p className="tool-detail">{parseNames[call.tool]}{typeof parsed === "number" ? " · " + parsed + (parsed === 1 ? " source location" : " source locations") : ""}</p>
      {call.error && <p className="tool-error">{call.error}</p>}
    </div>
    <Badge variant={call.status === "failed" ? "destructive" : "outline"} className="tool-status"><Icon size={13} aria-hidden="true" className={call.status === "running" ? "animate-spin motion-reduce:animate-none" : undefined} />{status}</Badge>
  </div>;
};

export const TurnExecution = ({ activity }: { activity: TTurnActivity }) => <div className="tool-event">
  <span className="tool-icon"><Workflow size={15} /></span>
  <div className="min-w-0"><p className="tool-title">{activity.tool.replaceAll("_", " ")}</p><p className="tool-detail">{activity.result}</p></div>
  <Badge variant="outline" className="tool-status">{activity.status}</Badge>
</div>;

export const ResearchProgress = ({ job }: { job: TResearchJob }) => {
  const activity = job.activity ?? [];
  const active = job.status === "queued" || job.status === "running";
  const needsInput = job.status === "needs_input";
  const failed = job.status === "failed";
  const recordedWork = [
    typeof job.tool_steps === "number" ? `${job.tool_steps} tool ${job.tool_steps === 1 ? "step" : "steps"}` : null,
    typeof job.read_pages === "number" ? `${job.read_pages} ${job.read_pages === 1 ? "page" : "pages"} read` : null,
    typeof job.research_passes === "number" ? `${job.research_passes} research ${job.research_passes === 1 ? "pass" : "passes"}` : null,
  ].filter(Boolean).join(" · ");
  return <div>
    {(needsInput || failed) && <div className="research-outcome" role="status">
      <h3>{needsInput ? "More evidence needed" : "Research could not finish"}</h3>
      <p>{job.error || (needsInput ? "Attach evidence or add details in the conversation to revise the plan." : "Ask copitch to try again or revise the plan.")}</p>
    </div>}
    <Collapsible className="job-events" role="region" aria-label="Research activity">
      <CollapsibleTrigger asChild><Button type="button" variant="ghost" className="job-summary">
        <span className="tool-icon" aria-hidden="true">{active ? <LoaderCircle size={15} className="animate-spin motion-reduce:animate-none" /> : <Workflow size={15} />}</span>
        <span className="min-w-0 flex-1"><strong>Research activity</strong>
          {recordedWork && <span className="tool-detail">{recordedWork}</span>}
          <span className="tool-detail">{activity.at(-1)?.label ?? "Research job details"}</span></span>
        <Badge variant={failed ? "destructive" : "outline"} className={needsInput ? "text-evidence" : undefined}>{statusNames[job.status]}</Badge><ChevronDown size={14} aria-hidden="true" />
      </Button></CollapsibleTrigger>
      <CollapsibleContent>
        {activity.length ? <ol aria-label="Executed research steps">{activity.map(event => {
          const attention = attentionKinds.has(event.kind);
          const Icon = attention ? CircleAlert : informationKinds.has(event.kind) ? Minus : Check;
          return <li key={event.sequence} className={attention ? "text-evidence" : "text-muted-foreground"}>
            <Icon size={13} aria-hidden="true" /><span>{event.label}</span>
          </li>;
        })}</ol> : <p className="px-3 pb-3 text-sm text-muted-foreground">No activity recorded yet.</p>}
      </CollapsibleContent>
    </Collapsible>
  </div>;
};
