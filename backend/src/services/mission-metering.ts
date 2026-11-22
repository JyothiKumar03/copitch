import { AsyncLocalStorage } from "node:async_hooks";
import { wrapLanguageModel, type LanguageModel, type LanguageModelMiddleware } from "ai";
import { AppError } from "../errors/app-error";
import type { MissionRepository } from "../repositories/mission";
import type { TModelCandidate } from "../types/ai";

type TMissionMeter = {
  assert_active: () => void;
  reserve: (upper_usd: number) => string;
  settle: (receipt_id: string, actual_usd: number | null, retained_usd?: number) => void;
};
type TGenerateCall = Parameters<NonNullable<LanguageModelMiddleware["wrapGenerate"]>>[0];
type TUsage = Awaited<ReturnType<TGenerateCall["doGenerate"]>>["usage"];
const active_meter = new AsyncLocalStorage<TMissionMeter>();
export const mission_meter_active = () => !!active_meter.getStore();
export const with_mission_meter = <T>(meter: TMissionMeter, action: () => T) => active_meter.run(meter, action);

export const with_mission_job = async <T>(meter: TMissionMeter | undefined,
  work: (signal: AbortSignal) => Promise<T>, parent: AbortSignal = new AbortController().signal) => {
  if (!meter) return work(parent);
  meter.assert_active();
  const controller = new AbortController();
  const signal = AbortSignal.any([parent, controller.signal]);
  const timer = setInterval(() => {
    try { meter.assert_active(); } catch (reason) { controller.abort(reason); }
  }, 200);
  timer.unref();
  try {
    const result = await with_mission_meter(meter, () => work(signal));
    signal.throwIfAborted();
    meter.assert_active();
    return result;
  } finally {
    clearInterval(timer);
  }
};

export const commit_mission_result = <T>(repo: MissionRepository, meter: TMissionMeter | undefined, write: () => T) => {
  if (!meter) return write();
  return repo.atomic(() => {
    meter.assert_active();
    return write();
  });
};

const unpriced = () => new AppError(422, "This provider request has no verified spending bound for the approved mission.");
const token_count = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

// Responses web search is limited to 128k context per hosted call. Two mini models use a fixed 8k billing block.
// https://developers.openai.com/api/docs/guides/tools-web-search
// https://developers.openai.com/api/docs/pricing
const search_fee = 0.01;
const hosted_search = (model: string, params: TGenerateCall["params"]) => {
  const hosted = params.tools?.filter(tool => tool.type === "provider") ?? [];
  if (!hosted.length) return { calls: 0, tokens: 0, fixed: false };
  const calls = params.providerOptions?.openai?.maxToolCalls;
  if (hosted.length !== 1 || hosted[0].id !== "openai.web_search" || !token_count(calls) || calls < 1 || calls > 2) throw unpriced();
  const fixed = /^gpt-(?:4o-mini|4\.1-mini)(?:-\d{4}-\d{2}-\d{2})?$/u.test(model);
  return { calls, fixed, tokens: fixed ? 8000 : 131072 };
};

const reserve_request = (meter: TMissionMeter, candidate: TModelCandidate, params: TGenerateCall["params"]) => {
  meter.assert_active();
  params.abortSignal?.throwIfAborted();
  const rates = candidate.pricing;
  const output = params.maxOutputTokens;
  if (!rates || !token_count(output) || !output) throw unpriced();
  const search = hosted_search(candidate.model, params);
  // Reserve UTF-8 bytes (one token per byte upper bound), including the schemas and framing.
  let image_tokens = 0;
  const encoded = JSON.stringify({ prompt: params.prompt, tools: params.tools, output: params.responseFormat,
    provider: params.providerOptions }, (_key, value) => {
    if (value?.type !== "file") return value;
    // Only the local JPEG render is supported. Patch-based models reject images exceeding 30k patches.
    // https://developers.openai.com/api/docs/guides/images-vision
    if (value.mediaType !== "image/jpeg" || value.data?.type !== "data" ||
      !/^gpt-(?:5\.4(?:-mini|-nano)?|5\.5|5\.6-(?:luna|sol|terra)|6(?:\.1|\.2)?-(?:luna|sol|astra|terra))(?:-\d{4}-\d{2}-\d{2})?$/u.test(candidate.model)) throw unpriced();
    image_tokens += 131072;
    return { ...value, data: null };
  });
  const input = Buffer.byteLength(encoded) + 8192 + image_tokens;
  const input_rate = Math.max(rates.input, rates.cached_input);
  const search_content_usd = search.tokens * input_rate / 1_000_000;
  const upper = (input * input_rate + output * rates.output) / 1_000_000 + search.calls * (search_fee + search_content_usd);
  const receipt = meter.reserve(upper);
  return (usage: TUsage, calls: number) => {
    const tokens = usage.inputTokens.total;
    const generated = usage.outputTokens.total;
    const cached = usage.inputTokens.cacheRead;
    if (!token_count(tokens) || !token_count(generated) || calls > search.calls ||
      (cached !== undefined && (!token_count(cached) || cached > tokens))) return;
    // Cached input is a subset of total input. A missing split leaves only the rate difference uncertain.
    const known_input = cached === undefined ? tokens * Math.min(rates.input, rates.cached_input)
      : (tokens - cached) * rates.input + cached * rates.cached_input;
    const unknown_input = cached === undefined ? tokens * input_rate - known_input : 0;
    const content = calls * search_content_usd;
    const actual = (known_input + generated * rates.output) / 1_000_000 + calls * search_fee + (search.fixed ? content : 0);
    // Variable search content is not itemized separately. Keep its ceiling committed until itemized billing arrives.
    const uncertain = unknown_input / 1_000_000 + (search.fixed ? 0 : content);
    // Reported input may already include some search content. Total commitment stays within the original bound.
    meter.settle(receipt, actual, Math.min(uncertain, Math.max(0, upper - actual)));
  };
};

export const metered_model = (candidate: TModelCandidate, model: LanguageModel): LanguageModel => {
  const meter = active_meter.getStore();
  if (!meter) return model;
  if (typeof model === "string") throw unpriced();
  return wrapLanguageModel({ model, middleware: {
    wrapGenerate: async ({ doGenerate, params }) => {
      const settle = reserve_request(meter, candidate, params);
      const result = await doGenerate();
      settle(result.usage, result.content.filter(part => part.type === "tool-call" && part.providerExecuted).length);
      return result;
    },
    wrapStream: async ({ doStream, params }) => {
      const settle = reserve_request(meter, candidate, params);
      let calls = 0;
      const result = await doStream();
      return { ...result, stream: result.stream.pipeThrough(new TransformStream({
        transform(part, controller) {
          if (part.type === "tool-call" && part.providerExecuted) calls++;
          if (part.type === "finish") settle(part.usage, calls);
          controller.enqueue(part);
        },
      })) };
    },
  } });
};
