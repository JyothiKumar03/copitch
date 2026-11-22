import { ChevronDown, ClipboardList, FolderOpen, Presentation, Workflow } from "lucide-react";
import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { TContextArtifactProps } from "@/types/research";
import { ContextArtifact } from "./ContextArtifact";

type TWorkspaceArtifactsProps = {
  currentResearch?: TContextArtifactProps;
  earlierResearch: TContextArtifactProps[];
  onPlan?: () => void;
  onActivity?: () => void;
  onMission?: () => void;
  onPresentation?: () => void;
  expanded: boolean;
  onToggle: () => void;
};

export const WorkspaceArtifacts = ({ currentResearch, earlierResearch, onPlan, onActivity, onMission, onPresentation, expanded, onToggle }: TWorkspaceArtifactsProps) => {
  const disclosure = useRef<HTMLButtonElement>(null);
  const hasArtifacts = !!(onPlan || onActivity || onMission || currentResearch || onPresentation || earlierResearch.length);
  return <aside className="cockpit-artifacts" aria-label="Project artifacts" onKeyDown={event => {
    if (event.key === "Escape" && expanded && event.currentTarget.contains(event.target as Node)) {
      onToggle();
      disclosure.current?.focus();
    }
  }}>
    <Button ref={disclosure} variant="outline" className="compact-artifacts" type="button" aria-expanded={expanded} aria-controls="studio-artifact-list" onClick={onToggle}>
      <FolderOpen size={16} aria-hidden="true" className="text-primary" /> Artifacts <ChevronDown size={13} aria-hidden="true" />
    </Button>
    <Card className="artifact-list" id="studio-artifact-list" data-expanded={expanded}>
      <h2 className="flex items-center gap-2 border-b border-border px-4 py-3 text-sm font-semibold"><FolderOpen size={16} aria-hidden="true" className="text-primary" /> Project artifacts</h2>
      <div className="grid gap-1 p-2.5">
        {onPlan && <Button type="button" variant="ghost" size="sm" className="justify-start px-2.5" onClick={onPlan}><ClipboardList size={16} aria-hidden="true" className="text-muted-foreground" />Research plan</Button>}
        {onMission && <Button type="button" variant="ghost" size="sm" className="justify-start px-2.5" onClick={onMission}><Workflow size={16} aria-hidden="true" className="text-muted-foreground" />Mission</Button>}
        {onActivity && <Button type="button" variant="ghost" size="sm" className="justify-start px-2.5" onClick={onActivity}><Workflow size={16} aria-hidden="true" className="text-muted-foreground" />Research activity</Button>}
        {currentResearch && <ContextArtifact {...currentResearch} label="Saved research brief" variant="ghost" />}
        {onPresentation && <Button type="button" variant="ghost" size="sm" className="justify-start px-2.5" onClick={onPresentation}><Presentation size={16} aria-hidden="true" className="text-muted-foreground" />Presentation</Button>}
        {!!earlierResearch.length && <details className="border-t border-border px-2.5 pb-1 pt-2">
          <summary className="text-xs font-semibold text-muted-foreground">Earlier research</summary>
          <div className="mt-1 grid gap-1">{earlierResearch.map((artifact, index) => <ContextArtifact key={artifact.researchId} {...artifact}
            label={earlierResearch.length === 1 ? "Earlier brief" : `Earlier brief ${index + 1}`} variant="ghost" />)}</div>
        </details>}
        {!hasArtifacts && <p className="px-2 py-1 text-sm leading-snug text-muted-foreground">Your research and slides will appear here.</p>}
      </div>
    </Card>
  </aside>;
};
