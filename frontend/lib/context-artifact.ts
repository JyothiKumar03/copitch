import type { TResearchSession } from "@/types/research";
import { request } from "./research";

const maxDocumentLength = 2_000_000;
const maxEventLength = 250_000;
const contextPath = (session: TResearchSession, researchId: string) =>
  `/api/sessions/${encodeURIComponent(session.session_id)}/research/${encodeURIComponent(researchId)}/context.md`;

const decodeEvent = (record: string) => {
  let event = "";
  const data: string[] = [];
  for (const line of record.split(/\r?\n/u)) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /u, ""));
  }
  if (event === "done") return { done: true } as const;
  if (event !== "delta") return null;
  const value: unknown = JSON.parse(data.join("\n"));
  if (!value || typeof value !== "object" || !("text" in value) || typeof value.text !== "string") {
    throw new Error("The context stream sent an unreadable update.");
  }
  return { done: false, text: value.text } as const;
};

export const streamContextMarkdown = async (session: TResearchSession, researchId: string, signal: AbortSignal, onDelta: (text: string) => void) => {
  const response = await request(contextPath(session, researchId), session, undefined, { signal, headers: { Accept: "text/event-stream" } });
  const contentType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  const streaming = contentType === "text/event-stream";
  if (!response.body || (!streaming && contentType !== "text/markdown" && contentType !== "text/plain")) {
    throw new Error("The saved context was unavailable.");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let markdown = "";
  let pending = "";
  let complete = false;
  const append = (text: string) => {
    markdown += text;
    if (markdown.length > maxDocumentLength) throw new Error("The saved context is too large to preview.");
    onDelta(text);
  };
  const consume = (chunk: string) => {
    if (!streaming) { append(chunk); return; }
    pending += chunk;
    for (;;) {
      const separator = /\r?\n\r?\n/u.exec(pending);
      if (!separator) break;
      if (separator.index > maxEventLength) throw new Error("A context update was too large.");
      const event = decodeEvent(pending.slice(0, separator.index));
      pending = pending.slice(separator.index + separator[0].length);
      if (event?.done) { complete = true; break; }
      if (event) append(event.text);
    }
    if (pending.length > maxEventLength) throw new Error("A context update was too large.");
  };
  try {
    while (!complete) {
      const part = await reader.read();
      if (part.done) { consume(decoder.decode()); break; }
      consume(decoder.decode(part.value, { stream: true }));
    }
    if (streaming && !complete) throw new Error("The context stream was interrupted. Reopen the file to try again.");
    return markdown;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
};

export const downloadContextMarkdown = async (session: TResearchSession, researchId: string) => {
  const response = await request(contextPath(session, researchId), session, undefined, { headers: { Accept: "text/markdown" } });
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = "context.md";
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};
