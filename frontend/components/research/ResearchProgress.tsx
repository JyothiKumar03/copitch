import { Check, CircleDot, AlertCircle } from "lucide-react";
import type { TResearchJob } from "@/types/research";

export const ResearchProgress = ({ job }: { job?: TResearchJob }) => {
  const activity = job?.activity ?? [];
  return <section aria-label="Research activity" className="border-b border-border py-4">
    <h3 className="mb-3 font-semibold">Research activity</h3>
    {activity.length ? <ol role="log" aria-live="polite" className="max-h-64 space-y-2 overflow-y-auto pr-1 text-sm">
      {activity.map(event => {
        const Icon = ["failed", "lookup_failed", "fallback", "superseded"].includes(event.kind) ? AlertCircle :
          ["completed", "verified", "sources_saved", "page_opened", "search_completed"].includes(event.kind) ? Check : CircleDot;
        return <li key={event.sequence} className="flex items-start gap-2"><Icon aria-hidden="true" size={14} className="mt-1 shrink-0 text-primary" />
          <span className="min-w-0 break-words">{event.label}</span>
        </li>;
      })}
    </ol> : <p role="status" className="text-sm text-muted-foreground">{job ? "Research " + job.status + "." : "No research has started for this brief."}</p>}
  </section>;
};
