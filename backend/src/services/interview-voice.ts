import { AppError } from "../errors/app-error";
import { z } from "zod";
import { DEFAULT_LANGUAGE } from "../../../shared/languages";

export const max_recording_bytes = 8 * 1024 * 1024;
const supported_audio: Record<string,string> = {
  "audio/webm":"audio/webm", "video/webm":"audio/webm",
  "audio/mp4":"audio/mp4", "video/mp4":"audio/mp4", "audio/m4a":"audio/mp4", "audio/x-m4a":"audio/mp4",
  "audio/ogg":"audio/ogg", "application/ogg":"audio/ogg", "audio/x-ogg":"audio/ogg",
  "audio/wav":"audio/wav", "audio/x-wav":"audio/wav", "audio/wave":"audio/wav", "audio/vnd.wave":"audio/wav",
  "audio/mpeg":"audio/mpeg", "audio/mp3":"audio/mpeg", "audio/x-mp3":"audio/mpeg",
};

export const recording_type = (mime: string) => {
  const base = mime.split(";",1)[0].trim().toLowerCase();
  return Object.hasOwn(supported_audio,base) ? supported_audio[base] : undefined;
};

// Count bytes while reading even when chunked transport omits Content-Length.
const bounded_body = async (input: Response, maximum: number, oversized: AppError) => {
  if (Number(input.headers.get("Content-Length")) > maximum) throw oversized;
  const reader = input.body?.getReader();
  if (!reader) return new Uint8Array(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const {done,value} = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maximum) {
        await reader.cancel();
        throw oversized;
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk,offset);
    offset += chunk.length;
  }
  return bytes;
};

export const call_voice_worker = async (
  operation: "transcribe" | "connect" | "presentation-connect" | "speech", content_type: string, body: Blob | string,
  fetch_worker: (url:string, options:RequestInit) => Promise<Response> = fetch,
  language: string = DEFAULT_LANGUAGE,
  client_signal?: AbortSignal,
) => {
  const token = process.env.VOICE_WORKER_TOKEN?.trim();
  let base: URL;
  try {
    base = new URL(process.env.VOICE_WORKER_URL ?? "http://127.0.0.1:8900");
    if (!["http:","https:"].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new Error();
  } catch { throw new AppError(503,"Interview voice worker is unavailable"); }
  if (!token) throw new AppError(503,"Interview voice worker is unavailable");
  const timeout = AbortSignal.timeout(45000);
  const signal = client_signal ? AbortSignal.any([client_signal, timeout]) : timeout;
  try {
    const response = await fetch_worker(base.href.replace(/\/$/,"") + "/" + operation,{
      method:"POST", redirect:"error", signal, body,
      headers:{ "Content-Type":content_type, Authorization:"Bearer " + token, "X-Interview-Language": language },
    });
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      if (response.status === 413) throw new AppError(413,"Recording exceeds the worker limit");
      if (response.status === 415) throw new AppError(415,"Unsupported recording format");
      if (response.status === 400 || response.status === 422) throw new AppError(422,"Worker could not process the supplied input");
      if (response.status === 429) throw new AppError(429,"Interview voice capacity is busy");
      if ([401,403,503,504].includes(response.status)) throw new AppError(503,"Interview voice worker is unavailable");
      throw new AppError(502,"Interview voice request failed");
    }
    const mime = response.headers.get("Content-Type")?.split(";",1)[0].trim().toLowerCase();
    const invalid = new AppError(502,"Interview voice worker returned an invalid response");
    if (operation === "speech") {
      if (mime !== "audio/mpeg") throw invalid;
      const bytes = await bounded_body(response, 12 * 1024 * 1024, invalid);
      if (!bytes.length) throw invalid;
      return { kind: "audio" as const, bytes };
    }
    if (operation === "connect" || operation === "presentation-connect") {
      if (mime !== "application/sdp") throw invalid;
      const sdp = new TextDecoder().decode(await bounded_body(response, 65536, invalid));
      if (!sdp.startsWith("v=0")) throw invalid;
      return { kind: "sdp" as const, sdp, session_id: response.headers.get("x-voice-session") };
    }
    if (mime !== "application/json") throw invalid;
    const bytes = await bounded_body(response,256 * 1024,invalid);
    let parsed: unknown;
    try { parsed = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw invalid; }
    const transcript = z.object({text:z.string().max(64000)}).safeParse(parsed);
    if (!transcript.success) throw invalid;
    return { kind: "text" as const, text: transcript.data.text };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(503,signal.aborted ? "Interview voice worker timed out" : "Interview voice worker is unavailable");
  }
};
