import { expect, test } from "bun:test";
import app from "../src/app";
import { serve_api } from "./helpers/serve-api";

test("project event streams authorize the connection, resume parser failures and close independently", async () => {
  process.env.AI_SESSION_DB = ":memory:";
  await using http = await serve_api(app);
  const register = async () => {
    const signup = await http.request("/api/account/register", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: crypto.randomUUID() + "@example.invalid", password: crypto.randomUUID() }) });
    expect(signup.status).toBe(201);
    return signup.headers.getSetCookie()[0].split(";")[0];
  };
  const cookie = await register();
  const another = await register();
  const project = await http.request("/api/projects", { method: "POST", headers: { cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Stream recovery" }) });
  const { session_id } = await project.json();
  const base = "/api/sessions/" + session_id;
  const events = (headers: Record<string, string>, signal?: AbortSignal) =>
    http.request(base + "/interview/events", { headers, signal });
  expect((await events({})).status).toBe(401);
  expect((await events({ cookie: another })).status).toBe(401);
  expect((await events({ cookie, "Last-Event-ID": "invalid" })).status).toBe(400);
  const initial = new AbortController();
  const stream = await events({ cookie }, initial.signal);
  expect(stream.headers.get("cache-control")).toContain("private");
  const reader = stream.body!.getReader();
  const decode = (value: Uint8Array | undefined) => new TextDecoder().decode(value);
  expect(decode((await reader.read()).value)).toContain("event: ready");
  initial.abort();

  const data = new FormData();
  data.append("file", new Blob(["invalid PowerPoint"]), "Private attachment.ppt");
  const failed = await http.request(base + "/research/sources", { method: "POST", headers: { cookie }, body: data });
  expect(failed.status).toBe(422);
  const history = await (await http.request(base + "/research/source-calls", { headers: { cookie } })).json();
  expect(history.calls[0]).toMatchObject({ tool: "parse_ppt", status: "failed", source: null });

  const resume = new AbortController();
  try {
    const replay = await events({ cookie, "Last-Event-ID": "0" }, resume.signal);
    const resumed = replay.body!.getReader();
    let frames = "";
    while (!frames.includes("event: ready")) {
      const next = await resumed.read();
      if (next.done) throw new Error("Event stream ended before recovery");
      frames += decode(next.value);
    }
    expect(frames).toContain(JSON.stringify({ kind: "sources", resource_id: history.calls[0].call_id }));
    expect(frames).not.toContain("Private attachment");
    expect((await http.request(base + "/interview/workspace", { headers: { cookie } })).status).toBe(200);
  } finally { resume.abort(); }
});
