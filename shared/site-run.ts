export type TSiteRunInput = {
  request_id: string;
  url: string;
  audience: string;
  goal: string;
  max_depth: number;
  approved: true;
};

export type TSiteWallKind = "off_site" | "skipped_consequential" | "needs_account" | "bot_check" | "payment" |
  "dead_end" | "outside_depth" | "repeated" | "unavailable";

export type TSiteWall = { url: string; label: string; kind: TSiteWallKind; reason: string };
export type TSiteStep = { n: number; url: string; title: string; caption: string; facts: string[]; depth: number };
export type TSiteActivity = { n: number; label: string };

export type TSiteReceipt = {
  n: number;
  model: string;
  status: "reserved" | "completed" | "failed";
  priced_usd: number;
  estimated: boolean;
  pricing_version?: string;
  input_tokens?: number;
  output_tokens?: number;
};

export type TSiteRun = Omit<TSiteRunInput, "approved" | "request_id"> & {
  run_id: string;
  status: "queued" | "running" | "completed" | "failed" | "stopped";
  engine: "model" | "browser";
  created_at: number;
  resumed: boolean;
  budget_usd: number;
  spent_usd: number;
  receipts?: TSiteReceipt[];
  usage_estimated: boolean;
  goal_met: boolean;
  steps: TSiteStep[];
  activity: TSiteActivity[];
  coverage: { visited: string[]; walls: TSiteWall[]; frontier: number; remaining?: { url: string; label: string }[] };
  has_powerpoint: boolean;
  summary?: string;
};
