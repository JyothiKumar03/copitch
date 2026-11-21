import { expect, test } from "bun:test";
import app, { create_api } from "../src/app";
import { database } from "../src/repositories/store";
import { serve_api } from "./helpers/serve-api";

test("a private project survives sign-out and fresh login, and only its owner can access it", async () => {
  process.env.AI_SESSION_DB = ":memory:";
  await using http = await serve_api(app);
  const post = (path: string, body: unknown, cookie = "", origin?: string) => http.request(path, {
    method: "POST", headers: { "Content-Type": "application/json", cookie, ...(origin && { origin }) }, body: JSON.stringify(body),
  });
  const get = (path: string, cookie = "") => http.request(path, { headers: {cookie} });
  const identity = () => ({ email: crypto.randomUUID() + "@example.test", password: crypto.randomUUID() });
  const owner = identity();
  const other = identity();
  const cookie = (response: Response) => response.headers.get("set-cookie")!.split(";")[0];
  expect((await get("/api/projects")).status).toBe(401);
  const signup = await post("/api/account/register", owner);
  expect(signup.status).toBe(201);
  expect(signup.headers.get("set-cookie")).toContain("HttpOnly");
  const owner_login = cookie(signup);
  expect((await post("/api/projects", { name: "Cross site" }, owner_login, "https://other.example")).status).toBe(403);
  const created = await post("/api/projects", { name: "Annual planning" }, owner_login);
  expect(created.status).toBe(201);
  const { session_id } = await created.json();
  const workspace = "/api/sessions/" + session_id + "/interview/workspace";
  const brief = { brief_id: crypto.randomUUID(), messages: ["Customer forecast"], materials: "", urls: [],
    source_policy: "files_only" as const, summary: "Customer forecast", question: null, public_queries: [] };
  const research_id = crypto.randomUUID();
  database().replace_brief(session_id, undefined, brief);
  database().save_research(session_id, { research_id, brief_id: brief.brief_id, confirmed_brief: brief,
    markdown: "Customer forecast memo", evidence: [], findings: { title: "Forecast", sections: [] },
    gaps: [], pitch_markdown: "# Private forecast" });
  const project_artifact = "/api/sessions/" + session_id + "/research/" + research_id + "/pitch.md";
  expect(await (await get(project_artifact, owner_login)).text()).toBe("# Private forecast");
  expect((await get(workspace, owner_login)).status).toBe(200);
  const other_login = cookie(await post("/api/account/register", other));
  expect((await (await get("/api/projects", other_login)).json()).projects).toEqual([]);
  expect((await get(workspace, other_login)).status).toBe(401);
  expect((await get(project_artifact, other_login)).status).toBe(401);
  expect((await post("/api/account/logout", {}, owner_login)).status).toBe(204);
  expect((await get(workspace, owner_login)).status).toBe(401);
  expect((await post("/api/account/login", { ...owner, password: "incorrect" })).status).toBe(401);
  const restored = cookie(await post("/api/account/login", owner));
  expect(restored).not.toBe(owner_login);
  const result = await (await get("/api/projects", restored)).json();
  expect(result.projects.map((p: {session_id:string}) => p.session_id)).toEqual([session_id]);
  expect((await (await get(workspace, restored)).json()).research.research_id).toBe(research_id);
  expect(await (await get(project_artifact, restored)).text()).toBe("# Private forecast");
  const legacy = await (await post("/api/sessions", {})).json();
  const import_path = "/api/projects/import";
  expect((await post(import_path, { ...legacy, token: "x".repeat(43), name: "Wrong key" }, other_login)).status).toBe(403);
  expect((await post(import_path, { ...legacy, name: "Previous pitch" }, restored)).status).toBe(201);
  expect((await post(import_path, { ...legacy, name: "Wrong account" }, other_login)).status).toBe(403);
  const legacy_workspace = "/api/sessions/" + legacy.session_id + "/interview/workspace";
  expect((await http.request(legacy_workspace, { headers: { Authorization: "Bearer " + legacy.token } })).status).toBe(401);
  expect((await get(legacy_workspace, restored)).status).toBe(200);
});

test("hosted provider entry points require account access", async () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    await using http = await serve_api(app);
    for (const path of ["/api/chat", "/api/CHAT/", "/api/sessions", "/api/sessions/anything/interview/connect"]) {
      expect((await http.request(path, { method: "POST" })).status).toBe(401);
    }
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});

test("only the private gateway deployment attributes sign-ins to the nearest forwarded client", async () => {
  const previous = process.env.COPITCH_TRUST_GATEWAY;
  try {
    for (const enabled of ["0", "1"]) {
      process.env.COPITCH_TRUST_GATEWAY = enabled;
      const fixture = create_api();
      fixture.get("/client-address", (req, res) => res.json(req.ip));
      await using http = await serve_api(fixture);
      for (const address of ["192.0.2.1", "192.0.2.2"]) {
        const response = await http.request("/client-address", { headers: { "X-Forwarded-For": "198.51.100.1, " + address } });
        const observed = await response.json();
        if (enabled === "1") expect(observed).toBe(address);
        else expect(observed).toMatch(/127\.0\.0\.1/);
      }
    }
  } finally {
    if (previous === undefined) delete process.env.COPITCH_TRUST_GATEWAY;
    else process.env.COPITCH_TRUST_GATEWAY = previous;
  }
});
