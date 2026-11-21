import { serve_api } from "./helpers/serve-api";
import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import app from "../src/app";
import { database } from "../src/repositories/store";
import { ContinuationStore } from "../src/repositories/continuation";
import type { TContinuationEvent } from "../src/types/continuation";

test("session API persists explicit skips and rejects forged delivery evidence and stale approvals", async () => {
  process.env.AI_SESSION_DB = ":memory:";
  await using http = await serve_api(app);
  const response = await http.request("/api/sessions", { method: "POST" });
  const host = await response.json();
  const auth = { Authorization: "Bearer " + host.token, "Content-Type": "application/json" };
  const deck_id = crypto.randomUUID();
  const slide_id = "intro";
  const deck = {
    deck_id, revision: 1, research_id: crypto.randomUUID(), title: "Trial",
    slides: [{ slide_id, title: "Intro", layout: "headline" as const, narration: "Welcome.", highlights: ["Intro"], evidence_ids: [] }],
  };
  database().decks.create(host.session_id, deck);
  const url = "/api/sessions/" + host.session_id + "/continuation";
  const post = (path: string, body: unknown) => http.request(url + path, {
    method: "POST", headers: auth, body: JSON.stringify(body),
  });
  expect((await http.request(url + "?deck_id=" + deck_id)).status).toBe(401);
  expect((await post("/start", { deck_id, revision: 1 })).status).toBe(200);
  const event = {
    deck_id, expected_revision: 1, generation: 0, event_id: "command-1", action: { kind: "skip", point_id: slide_id },
  };
  for (const kind of ["observed", "playout", "paint"]) {
    const variants = {
      observed: { attempt_id: "demo", outcome: "setup", frame_id: "frame" },
      playout: { attempt_id: "audio", asset_id: "clip", natural: true, certain: true },
      paint: { attempt_id: "demo", frame_id: "frame", visible: true },
    };
    expect((await post("/commands", { ...event, action: { kind, ...variants[kind as keyof typeof variants] } })).status).toBe(403);
  }
  const result = await (await post("/commands", event)).json();
  expect(result.next).toEqual({ kind: "done" });
  expect(result.points[0]).toMatchObject({ skipped: true, spoken: "pending", demo: "pending" });
  expect(await (await post("/commands", event)).json()).toEqual(result);
  expect((await post("/commands", { ...event, action: { kind: "revisit", point_id: slide_id } })).status).toBe(409);
  const history = await (await http.request(url + "/events?deck_id=" + deck_id, { headers: auth })).json();
  expect(history.events.map((entry: { event: TContinuationEvent }) => entry.event.action.kind)).toEqual(["skip"]);
  const edit = database().decks.propose(host.session_id, deck_id, {
    command_id: "edit", base_revision: 1, slide_id, changes: { narration: "Hello!" },
  });
  database().decks.decide(host.session_id, deck_id, edit.proposal_id, "approve");
  expect((await post("/commands", event)).status).toBe(409);
  const revised = await (await post("/start", { deck_id, revision: 2 })).json();
  expect(revised.next).toEqual({ kind: "speak", point_id: slide_id });
});

test("reopening a ledger fences old playback, preserves interruption and ordered replay", () => {
  const db = new Database(":memory:");
  const first = new ContinuationStore(db);
  first.start("room", "deck", 1, [{ point_id: "A", requirement: "spoken" }]);
  const event = { session_id: "room", expected_revision: 1, generation: 0, event_id: "play",
    action: { kind: "play", point_id: "A", attempt_id: "attempt", asset_id: "clip" } } as const;
  first.apply("room", "deck", "host", event);
  const second = new ContinuationStore(db);
  second.recover();
  const state = second.get("room", "deck")!;
  expect(state.generation).toBe(1);
  expect(state.points[0].spoken).toBe("partial");
  expect(state.playback).toBeNull();
  expect(() => second.apply("room", "deck", "player", { ...event, event_id: "late-end",
    action: { kind: "playout", attempt_id: "attempt", asset_id: "clip", natural: true, certain: true } })).toThrow();
  expect(second.events("room", "deck", 0).map(row => row.event.action.kind)).toEqual(["play", "reconnect"]);
  db.close();
});
