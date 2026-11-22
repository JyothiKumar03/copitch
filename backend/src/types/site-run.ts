import { z } from "zod";
import { DEFAULT_WEBSITE_WALKTHROUGH_DEPTH, WEBSITE_WALKTHROUGH_DEPTHS } from "../../../shared/website-walkthrough";
import type { TSiteActivity, TSiteReceipt, TSiteRun, TSiteStep, TSiteWall } from "../../../shared/site-run";

export const site_run_input = z.strictObject({
  request_id: z.uuid(), url: z.string().trim().min(1).max(2048),
  audience: z.string().trim().min(1).max(180), goal: z.string().trim().min(1).max(600),
  max_depth: z.literal(WEBSITE_WALKTHROUGH_DEPTHS).default(DEFAULT_WEBSITE_WALKTHROUGH_DEPTH), approved: z.literal(true),
});

const ref = z.string().regex(/^e[1-9]\d{0,2}$/u);
export const site_action = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("navigate"), url: z.string().max(2048) }),
  z.strictObject({ kind: z.literal("click"), ref }),
  z.strictObject({ kind: z.literal("select"), ref, option: z.string().max(120) }),
  z.strictObject({ kind: z.literal("view_example"), ref: z.string().regex(/^x[1-9]\d{0,2}$/u) }),
  z.strictObject({ kind: z.literal("scroll"), direction: z.enum(["up", "down"]) }),
  z.strictObject({ kind: z.literal("back") }),
  z.strictObject({ kind: z.literal("record_step"), facts: z.array(z.number().int().min(0).max(11)).max(4) }),
  z.strictObject({ kind: z.literal("finish"), goal_met: z.boolean() }),
]);

export type TSiteAction = z.infer<typeof site_action>;
export type TSiteElement = { ref: string; role: string; name: string; href?: string; enabled: boolean; options?: string[] };
export type TSiteObservation = { url: string; title: string; facts: string[]; elements: TSiteElement[]; examples?: { ref: string; text: string }[]; code_facts?: string[]; screenshot: Buffer;
  password_field: boolean; payment_field: boolean; challenge: boolean };
export type TSiteTarget = { url: string; label: string; depth: number; branch: string };
export type TSiteCheckpoint = {
  current?: TSiteTarget;
  frontier: TSiteTarget[];
  attempted: string[];
  visited: string[];
  walls: TSiteWall[];
  steps: TSiteStep[];
  activity: TSiteActivity[];
  actions: number;
  spent_usd: number;
  receipts?: TSiteReceipt[];
  usage_estimated: boolean;
  branch_spend: Record<string, number>;
  branch_visits: Record<string, number>;
  screens: string[];
  goal_reviews?: string[];
  goal_met: boolean;
  final_summary?: string;
};

export type TSiteLease = Pick<TSiteRun, "run_id" | "url" | "audience" | "goal" | "max_depth" | "budget_usd" | "created_at"> & {
  lease_token: string;
  engine: TSiteRun["engine"];
  checkpoint: TSiteCheckpoint;
};
