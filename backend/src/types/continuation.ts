import { z } from "zod";

const id = z.string().min(1).max(192);
const kind = <T extends string>(value: T) => z.literal(value);
export const point_schema = z.strictObject({
  point_id: id, requirement: z.enum(["spoken", "either", "both"]),
});
export type TPointSpec = z.infer<typeof point_schema>;
export type TRequirement = TPointSpec["requirement"];
export type TContinuationRole = "host" | "player" | "worker" | "stage";
export const continuation_action = z.discriminatedUnion("kind", [
  z.strictObject({ kind: kind("play"), point_id: id, attempt_id: id, asset_id: id }),
  z.strictObject({ kind: kind("interrupt"), attempt_id: id }),
  z.strictObject({ kind: kind("playout"), attempt_id: id, asset_id: id, natural: z.boolean(), certain: z.boolean() }),
  z.strictObject({ kind: kind("prepare"), point_id: id, attempt_id: id }),
  z.strictObject({ kind: kind("observed"), attempt_id: id, outcome: z.enum(["setup", "login", "timeout", "obscured"]), frame_id: id.optional() }),
  z.strictObject({ kind: kind("paint"), attempt_id: id, frame_id: id, visible: z.boolean() }),
  z.strictObject({ kind: kind("cancel_demo"), attempt_id: id }),
  z.strictObject({ kind: kind("skip"), point_id: id }),
  z.strictObject({ kind: kind("revisit"), point_id: id }),
  z.strictObject({ kind: kind("reconnect") }),
]);
export const continuation_event = z.strictObject({
  event_id: id, session_id: id, expected_revision: z.number().int().positive(),
  generation: z.number().int().nonnegative(), action: continuation_action,
});
export type TContinuationEvent = z.infer<typeof continuation_event>;
export type TContinuationAction = z.infer<typeof continuation_action>;
export type TPointCoverage = TPointSpec & {
  spoken: "pending" | "partial" | "complete";
  demo: "pending" | "blocked" | "displayed";
  skipped: boolean;
};
export type TContinuationState = {
  session_id: string; revision: number; generation: number;
  points: TPointCoverage[];
  playback: { point_id: string; attempt_id: string; asset_id: string } | null;
  preparation: { point_id: string; attempt_id: string; frame_id: string | null } | null;
  used_attempts: string[];
};
export type TNextContinuation = { kind: "speak" | "demo" | "retry_or_skip"; point_id: string } | { kind: "done" };
