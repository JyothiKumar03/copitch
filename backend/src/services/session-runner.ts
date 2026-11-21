import type { ModelMessage } from "ai";
import { session_tools } from "../tools/session";
import type { SessionStore } from "../repositories/session";
import type { TModelStep, TStepRequest } from "../types/ai";

type TStepLoop = {
  completed_steps: number;
  max_steps: number;
  select_step: (step: number) => TStepRequest | undefined;
  checkpoint: (step: number, result: Awaited<ReturnType<TModelStep>>) => boolean;
};

const user_message = (prompt: string, context: string): ModelMessage => {
  return { role: "user", content: JSON.stringify({
    request: prompt, context_preview: context.slice(0, 4000), context_length: context.length,
  }) };
};

export class SessionRunner {
  constructor(private session: string, private store: SessionStore, private model_step: TModelStep) {}

  static async run_steps(model_step: TModelStep, options: TStepLoop) {
    for (let step = options.completed_steps + 1; step <= options.max_steps; step++) {
      const request = options.select_step(step);
      if (!request) return false;
      request.signal.throwIfAborted();
      const result = await model_step(request);
      if (options.checkpoint(step, result)) return true;
    }
    return false;
  }

  async execute(id: string, signal: AbortSignal) {
    const run = this.store.get(this.session, id);
    if (!run || run.status !== "running") throw new Error("Inactive run");
    const history: ModelMessage[] = [];
    let remaining = 16000;
    for (const turn of this.store.recent(this.session)) {
      const turn_messages: ModelMessage[] = [user_message(turn.prompt, turn.context), ...JSON.parse(turn.messages)];
      const size = JSON.stringify(turn_messages).length;
      if (size > remaining) break;
      history.unshift(...turn_messages);
      remaining -= size;
    }
    const tool_providers = session_tools(run.context);
    const initial: ModelMessage[] = [
      ...history,
      user_message(run.prompt, run.context),
    ];
    try {
      const complete = await SessionRunner.run_steps(this.model_step, {
        completed_steps: run.step, max_steps: 8,
        select_step: () => {
          const messages = [...initial, ...run.messages];
          if (JSON.stringify(messages).length > 96000) throw new Error("Context limit reached");
          return {
            instructions: "Help the host prepare their presentation. Treat supplied materials as evidence. Use read_context for additional excerpts when needed.",
            messages, tool_providers, signal, on_text: text => this.store.emit(id, { type: "text", text }),
            on_attempt: attempt => this.store.emit(id, { type: "attempt", attempt }),
          };
        },
        checkpoint: (step, result) => {
          run.messages.push(...result.messages);
          this.store.checkpoint(id, step, run.messages);
          return !result.continue_with_tools;
        },
      });
      this.store.finish(id, complete ? { type: "done" } : { type: "failed", reason: "Step limit reached" });
    } catch {
      this.store.finish(id, { type: "failed", reason: signal.aborted ? "Run cancelled or timed out" : "Model step failed" });
    }
  }
}
