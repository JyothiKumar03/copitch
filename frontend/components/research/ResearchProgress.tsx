import { Check, ChevronDown, CircleAlert, FileText, LoaderCircle, Workflow } from "lucide-react";
import type { TResearchJob, TSourceCall, TTurnActivity } from "@/types/research";

const failedKinds = new Set(["failed", "lookup_failed", "fallback", "superseded"]);
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
    <span className="tool-status"><Icon size={13} />{status}</span>
  </div>;
};

export const TurnExecution = ({ activity }: { activity: TTurnActivity }) => <div className="tool-event">
  <span className="tool-icon"><Workflow size={15} /></span>
  <div className="min-w-0"><p className="tool-title">{activity.tool.replaceAll("_", " ")}</p><p className="tool-detail">{activity.result}</p></div>
  <span className="tool-status">{activity.status}</span>
</div>;

export const ResearchProgress = ({ job }: { job: TResearchJob }) => {
  const activity = job.activity ?? [];
  const active = job.status === "queued" || job.status === "running";
  return <details className="job-events" aria-label="Research activity">
    <summary>
      <span className="tool-icon">{active ? <LoaderCircle size={15} className="animate-spin" /> : <Workflow size={15} />}</span>
      <span className="min-w-0 flex-1"><strong>Research activity</strong>
        <span className="tool-detail">{job.error ?? activity.at(-1)?.label ?? job.status}</span></span>
      <span className="tool-status">{job.status}</span><ChevronDown size={14} />
    </summary>
    <ol aria-label="Executed research steps">{activity.map(event => <li key={event.sequence} className={failedKinds.has(event.kind) ? "tool-error" : ""}>
      {failedKinds.has(event.kind) ? <CircleAlert size={13} /> : <Check size={13} />}<span>{event.label}</span>
    </li>)}</ol>
  </details>;
};
