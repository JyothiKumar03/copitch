import type { Request, Response } from "express";
import { z } from "zod";
import { AppError } from "../errors/app-error";
import { create_model_step } from "../services/ai-sdk";
import { configured_models_for } from "../services/model-config";

const body_schema = z.object({
  message: z.string().trim().min(1).max(8000),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(16000) })).optional(),
});

export const chat_reply = async (req: Request, res: Response) => {
  const body = body_schema.safeParse(req.body);
  if (!body.success) throw new AppError(400,"Invalid message or history");
  const models = configured_models_for("chat");
  if (!process.env.OPENAI_API_KEY || !models.length) {
    res.json({ reply: `I heard: "${body.data.message}". This is the starter reply from the Bun API. Configure OpenAI to enable model replies.` });
    return;
  }
  const history = (body.data.history ?? []).slice(-8);
  while (JSON.stringify(history).length > 16000) history.shift();
  const closed = new AbortController();
  const disconnect = () => closed.abort();
  res.once("close",disconnect);
  try {
    let reply = "";
    await create_model_step(models)({
      messages: [...history, { role: "user", content: body.data.message }],
      tool_providers: {}, signal: AbortSignal.any([closed.signal, AbortSignal.timeout(60000)]),
      on_text: text => { reply += text; }, on_attempt: () => {},
    });
    if (!closed.signal.aborted) res.json({ reply });
  } catch (error) {
    if (!closed.signal.aborted) throw error;
  } finally { res.off("close",disconnect); }
};
