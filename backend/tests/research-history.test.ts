import { expect, test } from "bun:test";
import { create_api } from "../src/app";
import { create_session } from "../src/controllers/session";
import { research_handlers } from "../src/controllers/research";
import { api_error } from "../src/middleware/api-error";
import { database } from "../src/repositories/store";
import { interview } from "../src/routes/interview";
import type { TResearchProvider } from "../src/types/research";
import { serve_api } from "./helpers/serve-api";

test("restored interview history contains only committed replies and preserves legacy host text", async () => {
  process.env.AI_SESSION_DB = ":memory:";
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const provider: TResearchProvider = {
    clarify: async scope => {
      const host = scope.messages.at(-1);
      if (host === "Discard this") { entered(); await gate; }
      return { summary: host === "Failed" ? "" : "Buyer pilot.", question: "How long?", public_queries: [] };
    },
    lookup: async () => { throw Error("Unused"); },
    draft: async () => { throw Error("Unused"); },
  };
  const app = create_api(interview);
  app.post("/api/sessions", create_session);
  app.post("/api/sessions/:session_id/research/brief", research_handlers(() => provider).review);
  app.use(api_error);
  await using http = await serve_api(app);
  const host = await (await http.request("/api/sessions", { method: "POST" })).json();
  const base = "/api/sessions/" + host.session_id;
  const headers = { Authorization: "Bearer " + host.token, "Content-Type": "application/json" };
  const saved = { brief_id: crypto.randomUUID(), messages: ["Pitch the buyer"], summary: "A buyer pitch.",
    question: "Which buyer?", public_queries: [], source_policy: "files_only" as const, urls: [], materials: "" };
  database().replace_brief(host.session_id, undefined, saved);
  const send = (message: string, brief_id: string) => http.request(base + "/research/brief",
    { method: "POST", headers, body: JSON.stringify({ message, brief_id, source_policy: "files_only" }) });
  const stale = send("Discard this", saved.brief_id);
  await started;
  const submitted = await (await send("Operations lead", saved.brief_id)).json();
  release();
  expect((await stale).status).toBe(409);
  expect((await send("Failed", submitted.brief_id)).status).toBe(502);
  const workspace = base + "/interview/workspace";
  expect((await http.request(workspace)).status).toBe(401);
  const restored = await (await http.request(workspace, { headers })).json();
  expect(restored.brief.history).toEqual([
    { role: "host", text: "Pitch the buyer" }, { role: "assistant", text: "A buyer pitch.\n\nWhich buyer?" },
    { role: "host", text: "Operations lead" }, { role: "assistant", text: "Buyer pilot.\n\nHow long?" },
  ]);
  expect(submitted.history).toEqual(restored.brief.history);
});
