import { createOpenAI } from "@ai-sdk/openai";
import { expect, test } from "bun:test";
import { research_provider } from "../src/services/research-provider";

test("reading a supplied URL requires a completed action on that page and an attributed finding", async () => {
  const url = "https://example.org/pilot";
  const passage = "Four enterprise trials converted.";
  for (const [type, target, expected] of [
    ["search", url, 0],
    ["open_page", "https://example.org/other", 0],
    ["open_page", url, 1],
    ["find_in_page", url, 1],
  ] as const) {
    const openai = createOpenAI({
      apiKey: "fixture",
      fetch: async () => Response.json({
        id: "resp_1", model: "fixture", created_at: 1, status: "completed",
        output: [
          { type: "web_search_call", id: "ws_1", status: "completed", action: { type, url: target, pattern: "enterprise" } },
          { type: "message", id: "msg_1", role: "assistant", content: [
            { type: "output_text", text: passage, annotations: [
              { type: "url_citation", title: "Pilot", url, start_index: 0, end_index: passage.length },
            ] },
          ] },
        ],
        usage: { input_tokens: 30, output_tokens: 20 },
      }),
    });
    const provider = research_provider({ model: "fixture", provider: "openai", max_output_tokens: 512, tool_providers: [] }, openai);
    const results = await provider.lookup("Read the page", url, AbortSignal.timeout(1000));
    expect(results).toHaveLength(expected);
    if (expected) expect(results[0]?.passage).toBe(passage);
  }
});
