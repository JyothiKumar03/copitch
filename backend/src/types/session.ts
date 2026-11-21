import type { ModelMessage } from "ai";
import type { TAttempt } from "./ai";

export type TSessionEvent =
  | { type: "text"; text: string }
  | { type: "attempt"; attempt: TAttempt }
  | { type: "done" }
  | { type: "failed"; reason: string };

export type TRun = {
  id: string;
  session: string;
  prompt: string;
  context: string;
  step: number;
  messages: ModelMessage[];
  status: "running" | "completed" | "failed";
};
