import { ArrowRight, Globe2, ListChecks, Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { TProposalChoice, TResearchProposal } from "@/types/research";

type TProposalProps = {
  proposal: TResearchProposal;
  filenames: string[];
  busy: boolean;
  changed: boolean;
  onChoose: (choice: TProposalChoice, label: string) => void;
};

export const StudioQuestion = ({ proposal, filenames, busy, changed, onChoose }: TProposalProps) => (
  <section className="studio-proposal" aria-label="Research plan">
    <h3><ListChecks size={16} aria-hidden="true" />Research plan</h3>
    <p className="proposal-summary">{proposal.summary}</p>
    {proposal.source_policy === "public_search" && proposal.queries.length > 0 && <div className="proposal-details">
      <h4>Searches</h4><ul>{proposal.queries.map(query => <li key={query}>{query}</li>)}</ul>
    </div>}
    {(filenames.length > 0 || proposal.urls.length > 0) && <div className="proposal-details">
      <h4>Sources</h4><ul className="proposal-sources">
        {filenames.map(name => <li key={name}><Paperclip size={13} />{name}</li>)}
        {proposal.urls.map(url => <li key={url}><Globe2 size={13} />{url}</li>)}
      </ul>
    </div>}
    {proposal.source_policy === "files_only" && <p className="tool-detail">Using only your materials.</p>}
    <div className="proposal-actions">
      <Button size="sm" disabled={busy || changed} onClick={() => onChoose("approve", "Start research")}>Start research <ArrowRight size={14} /></Button>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => onChoose("edit", "Change something")}>Change something</Button>
    </div>
  </section>
);
