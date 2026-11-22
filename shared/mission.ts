export type TOutcomeContract = {
  contract_id: string; revision: number; subject: string; audience: string; purpose: string;
  deliverable: { kind: "deck"; slide_count: number | "auto"; tone?: string; max_minutes?: number };
  must_include: { text: string; source: "host" }[];
  sources: { materials?: string; urls: string[]; files: string[]; public_search: boolean; site_tasks: { url: string; goal: string; mode: "read" | "interact" }[] };
  success_checks: string[];
  budget: { usd: number; minutes: number };
};

export type TMissionRetryPhase = "research" | "preparation" | "plan" | "review";
export type TMissionRetry = { retry_id: string; phase: TMissionRetryPhase };
export type TMissionStatus = "needs_approval" | "working" | "needs_input" | "delivered" | "stopped" | "paused";
export type TMissionStep = {
  sequence: number; tool: "set_contract" | "browse_site" | "research" | "prepare_deck" | "check_outcome" | "ask_host" | "stop" | "take_over" | "resume";
  summary: string; at: number; spent_usd?: number; reserved_usd?: number; contract_revision: number;
};
export type TMission = {
  mission_id: string; proposal_id: string | null; contract: TOutcomeContract; previous_contract: TOutcomeContract | null;
  status: TMissionStatus; approved_revision: number | null; started_at: number | null;
  site_run_id?: string | null; research_job_id: string | null; brief_id: string | null; research_id: string | null;
  deck_job_id: string | null; deck_id: string | null; deck_revision: number | null; host_edited_revision?: number | null;
  retry?: TMissionRetry | null;
  spent_usd: number; reserved_usd: number; gaps: string[]; steps: TMissionStep[];
};
