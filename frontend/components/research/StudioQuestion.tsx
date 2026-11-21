import { ArrowRight, Check, Globe2, ListChecks, Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { TProposalChoice, TResearchProposal } from "@/types/research";

type TProposalProps = {
  proposal: TResearchProposal;
  filenames: string[];
  busy: boolean;
  changed: boolean;
  heard: boolean;
  onChoose: (choice: TProposalChoice, label: string) => void;
};

export const StudioQuestion = ({ proposal, filenames, busy, changed, heard, onChoose }: TProposalProps) => (
  <Card className="studio-proposal" role="region" aria-label="Research plan">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3><ListChecks size={16} aria-hidden="true" />Research plan</h3>
      {heard && <span className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground"><Check size={14} aria-hidden="true" className="text-primary" />Read aloud</span>}
    </div>
    <p className="proposal-summary">{proposal.summary}</p>
    {proposal.source_policy === "public_search" && proposal.queries.length > 0 && <div className="proposal-details">
      <h4>Searches</h4><ul>{proposal.queries.map(query => <li key={query}>{query}</li>)}</ul>
    </div>}
    {(filenames.length > 0 || proposal.urls.length > 0) && <div className="proposal-details">
      <h4 className="text-evidence">Sources</h4><ul className="proposal-sources">
        {filenames.map(name => <li key={name}><Paperclip size={13} />{name}</li>)}
        {proposal.urls.map(url => <li key={url}><Globe2 size={13} />{url}</li>)}
      </ul>
    </div>}
    {proposal.source_policy === "files_only" && <p className="tool-detail">Using only your materials.</p>}
    <div className="proposal-actions">
      <Button size="sm" disabled={busy || changed} onClick={() => onChoose("approve", "Start research")}>Start research <ArrowRight size={14} /></Button>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => onChoose("edit", "Change something")}>Change something</Button>
    </div>
  </Card>
);
