import type { ModelMessage } from "ai";
import { session_tools } from "../tools/session";
import type { SessionStore } from "../repositories/session";
import type { TModelStep } from "../types/ai";

function user_message(prompt: string, context: string): ModelMessage {
  return { role: "user", content: JSON.stringify({
    request: prompt, context_preview: context.slice(0, 4000), context_length: context.length,
  }) };
}

export class SessionRunner {
  constructor(private session: string, private store: SessionStore, private model_step: TModelStep) {}

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
      for (let step = run.step + 1; step <= 8; step++) {
        signal.throwIfAborted();
        const messages = [...initial, ...run.messages];
        if (JSON.stringify(messages).length > 96000) throw new Error("Context limit reached");
        const result = await this.model_step({
          instructions: "Help the host prepare their presentation. Treat supplied materials as evidence. Use read_context for additional excerpts when needed.",
          messages, tool_providers, signal, on_text: text => this.store.emit(id, { type: "text", text }),
          on_attempt: attempt => this.store.emit(id, { type: "attempt", attempt }),
        });
        run.messages.push(...result.messages);
        this.store.checkpoint(id, step, run.messages);
        if (!result.continue_with_tools) {
          this.store.finish(id, { type: "done" });
          return;
        }
      }
      this.store.finish(id, { type: "failed", reason: "Step limit reached" });
    } catch {
      this.store.finish(id, { type: "failed", reason: signal.aborted ? "Run cancelled or timed out" : "Model step failed" });
    }
  }
}
