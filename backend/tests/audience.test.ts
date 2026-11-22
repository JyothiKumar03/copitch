import { serve_api } from "./helpers/serve-api";
import { expect, test } from "bun:test";
import app from "../src/app";
import { database } from "../src/repositories/store";
import type { TDeck } from "../src/types/deck";

test("scoped audience links follow published releases only across windows, revisions and expiry", async () => {
  process.env.AI_SESSION_DB = ":memory:";
  await using http = await serve_api(app);
  const host = await (await http.request("/api/sessions", { method: "POST" })).json();
  const deck: TDeck = { deck_id: crypto.randomUUID(), research_id: crypto.randomUUID(), revision: 1, title: "Public deck",
    slides: ["a", "b"].map(slide_id => ({
      slide_id, title: slide_id, highlights: ["Public highlight"], layout: "headline", evidence_ids: ["M151"], narration: "SECRET NARRATION",
      chart: { period: "2025", rows: [{ label: "Overall", numerator: 2, denominator: 10, evidence_id: "M151" }] },
    })) };
  database().decks.create(host.session_id, deck);
  const base = "/api/sessions/" + host.session_id + "/audience/";
  const post = (path: string, token: string, body: unknown) => http.request(base + path, { method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const read = (token: string) => http.request("/api/audience", { headers: { Authorization: "Bearer " + token } });
  const release = { deck_id: deck.deck_id, revision: 1, slide_id: "a" };
  const opened = await (await post("open", host.token, release)).json();
  expect(opened.sequence).toBe(1);
  expect((await read(host.token)).status).toBe(401);
  const response = await read(opened.token);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  const payload = await response.json();
  expect(payload).toEqual({ sequence: 1, revision: 1, deck_title: "Public deck", index: 0, total: 2,
    slide: { slide_id: "a", layout: "headline", title: "a", highlights: ["Public highlight"],
      chart: { period: "2025", rows: [{ label: "Overall", numerator: 2, denominator: 10 }] } } });
  expect(JSON.stringify(payload)).not.toContain("M151");
  expect((await post("publish", opened.token, { ...release, expected_sequence: 1 })).status).toBe(401);
  expect((await post("open", opened.token, release)).status).toBe(401);
  const second = await (await post("open", host.token, release)).json();
  expect(second.token).not.toEqual(opened.token);
  expect((await post("publish", host.token, { ...release, expected_sequence: 1, slide_id: "b" })).status).toBe(409);
  expect((await post("publish", host.token, { ...release, expected_sequence: 2, slide_id: "b" })).status).toBe(200);
  const edit = database().decks.propose(host.session_id, deck.deck_id, { command_id: "private", base_revision: 1,
    slide_id: "b", changes: { title: "New title", narration: "NEW SECRET" } });
  database().decks.decide(host.session_id, deck.deck_id, edit.proposal_id, "approve");
  for (const token of [opened.token, second.token]) {
    expect((await (await read(token)).json()).slide.title).toBe("b");
  }
  expect((await post("publish", host.token, { ...release, expected_sequence: 3 })).status).toBe(409);
  expect((await post("publish", host.token, { ...release, revision: 2, expected_sequence: 3, slide_id: "b" })).status).toBe(200);
  expect((await (await read(second.token)).json()).slide.title).toBe("New title");
  expect(database().audience.view(opened.token, opened.expires_at)).toBeUndefined();
  expect((await http.request("/api/audience?token=" + opened.token)).status).toBe(401);
});
