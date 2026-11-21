import { createOpenAI } from "@ai-sdk/openai";
import { expect, test } from "bun:test";
import app from "../src/app";
import { database } from "../src/repositories/store";
import { context_markdown } from "../src/services/context-markdown";
import { research_provider } from "../src/services/research-provider";
import type { TResearchBundle } from "../src/types/research";
import { serve_api } from "./helpers/serve-api";

const fixture = (): TResearchBundle => {
  const brief_id = crypto.randomUUID();
  const passage = "పన్నెండు teams enrolled. Revenue reporting is limited to March.";
  return {
    research_id: crypto.randomUUID(), brief_id, markdown: "Legacy report bytes",
    grounding: { mode: "verified", version: 1 }, pitch_markdown: "Legacy pitch bytes",
    confirmed_brief: { brief_id, source_policy: "files_only", messages: [], materials: passage, urls: [],
      summary: "Explain participation", question: null, public_queries: [] },
    findings: { title: "Enrollment", sections: [{ heading: "Participation", paragraphs: [
      { prose: passage, support: [{ evidence_id: "M1", excerpt: passage }] },
      { prose: "The source itself displayed <graph> as literal text.", support: [{ evidence_id: "M1", excerpt: passage }] },
      { prose: "The host led the pilot.", support: [{ evidence_id: "H1", excerpt: "I led the pilot." }] },
    ] }] },
    evidence: [{ id: "M1", origin: "material", location: "Selected notes", passage },
      { id: "H1", origin: "host", location: "Host note 1", passage: "I led the pilot." }],
    pitch_script: [{ purpose: "opening", prose: "Here is my talk track.", support: [] }], gaps: ["The total did not specify the number of users."],
  };
};

test("context route restores saved research with the same private Markdown and SSE bytes", async () => {
  process.env.AI_SESSION_DB = ":memory:";
  await using http = await serve_api(app);
  const register = async () => (await http.request("/api/sessions", { method: "POST" })).json() as Promise<{ session_id: string; token: string }>;
  const owner = await register();
  const stranger = await register();
  const bundle = fixture();
  const store = database();
  store.replace_brief(owner.session_id, undefined, bundle.confirmed_brief);
  store.save_research(owner.session_id, bundle);
  const path = "/api/sessions/" + owner.session_id + "/research/" + bundle.research_id;
  const auth = { Authorization: "Bearer " + owner.token };
  expect((await http.request(path + "/context.md")).status).toBe(401);
  expect((await http.request(path + "/context.md", { headers: { Authorization: "Bearer " + stranger.token } })).status).toBe(401);
  const download = await http.request(path + "/context.md", { headers: auth });
  expect(download.status).toBe(200);
  expect(download.headers.get("content-disposition")).toBe('attachment; filename="context.md"');
  const markdown = await download.text();
  expect(markdown).toBe(context_markdown(bundle)!);
  expect(markdown).toContain("పన్నెండు teams enrolled.");
  expect(markdown).not.toContain("Here is my talk track");
  expect(markdown).not.toContain("<graph>");
  expect(markdown).toContain("[^M1]: Selected notes");
  expect(markdown).toContain("The host led the pilot.");
  expect(markdown).not.toContain("[^H1]");
  expect(markdown).not.toContain("Host note 1");
  expect(store.research_by_id(owner.session_id, bundle.research_id)?.evidence.find(row => row.id === "H1")?.passage).toBe("I led the pilot.");
  const streamed = await http.request(path + "/context.md", { headers: { ...auth, Accept: "text/event-stream" } });
  expect(streamed.headers.get("content-type")).toContain("text/event-stream");
  const events = (await streamed.text()).trim().split("\n\n");
  expect(events.at(-1)).toBe("event: done\ndata: {}");
  const combined = events.slice(0, -1).map(event => JSON.parse(event.split("\ndata: ")[1]).text).join("");
  expect(combined).toBe(markdown);
  expect(await (await http.request(path + "/pitch.md", { headers: auth })).text()).toBe(bundle.pitch_markdown!);
});

test("the production writer streams a context schema and retains raw XML privately for validation", async () => {
  const bundle = fixture();
  const graph_xml = '<graph>{"name":"Candidate whose values still need verification"}</graph>';
  const raw = JSON.stringify({ title: "Enrollment", sections: [{ heading: "Participation", paragraphs: [
    { prose: bundle.evidence[0].passage, evidence_ids: ["M1"] },
  ] }], gaps: [], graph_xml });
  const openai = createOpenAI({ apiKey: "fixture", fetch: async (_url, request) => {
    const wire = JSON.parse(request!.body as string);
    expect(wire.stream).toBe(true);
    expect(wire.store).toBe(false);
    const fields = wire.text.format.schema.properties;
    expect(fields.graph_xml).toBeDefined();
    expect(fields.pitch_script).toBeUndefined();
    const events = [
      { type: "response.created", response: { id: "fixture", created_at: 1, model: "fake" } },
      { type: "response.output_item.added", output_index: 0, item: { type: "message", id: "reply" } },
      ...[raw.slice(0, 90), raw.slice(90)].map(delta => ({ type: "response.output_text.delta", output_index: 0, item_id: "reply", delta })),
      { type: "response.output_item.done", output_index: 0, item: { type: "message", id: "reply" } },
      { type: "response.completed", response: { usage: { input_tokens: 100, output_tokens: 70 } } },
    ];
    return new Response(events.map(event => "data: " + JSON.stringify(event) + "\n\n").join(""), {
      headers: { "Content-Type": "text/event-stream" },
    });
  } });
  const provider = research_provider({ provider: "openai", model: "fake", max_output_tokens: 1024, tool_providers: [] }, openai);
  const result = await provider.draft("Approved enrollment review", bundle.evidence, [], AbortSignal.timeout(2500), "context");
  expect(result.pitch_script).toBeUndefined();
  expect(result.graph_xml).toBe(graph_xml);
  expect(result.sections[0].paragraphs[0].support).toEqual([{ evidence_id: "M1", excerpt: "" }]);
});
