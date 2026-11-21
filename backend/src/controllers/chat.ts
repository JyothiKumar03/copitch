import type { Context } from "hono";
import { z } from "zod";
import { create_model_step } from "../services/ai-sdk";
import { configured_models } from "../services/model-config";

const body_schema = z.object({
  message: z.string().trim().min(1).max(8000),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(16000) })).optional(),
});

export async function chat_reply(c: Context) {
  const body = body_schema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "Invalid message or history" }, 400);
  const models = configured_models();
  if (!process.env.OPENAI_API_KEY || !models.length) {
    return c.json({ reply: `I heard: "${body.data.message}". This is the starter reply from the Bun API. Configure OpenAI to enable model replies.` });
  }
  const history = (body.data.history ?? []).slice(-8);
  while (JSON.stringify(history).length > 16000) history.shift();
  let reply = "";
  await create_model_step(models)({
    messages: [...history, { role: "user", content: body.data.message }],
    tool_providers: {}, signal: AbortSignal.any([c.req.raw.signal, AbortSignal.timeout(60000)]),
    on_text: text => { reply += text; },
    on_attempt: () => {},
  });
  return c.json({ reply });
}
