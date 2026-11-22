import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { until_aborted } from "../src/services/website-capture";

test("signed-in site run survives a fixture API process exit after the first saved screenshot", async () => {
  const dir = mkdtempSync(join(tmpdir(), "site-run-api-"));
  const port_probe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
  const port = port_probe.port!;
  await port_probe.stop(true);
  const base = "http://127.0.0.1:" + port + "/api";
  const launch = async (mode: string) => {
    const child = Bun.spawn([process.execPath, join(import.meta.dir, "fixtures/site-run-api.ts"), join(dir, "fixture.sqlite"), String(port), mode], {
      cwd: dir, stdout: "ignore", stderr: "inherit",
      env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: tmpdir() },
    });
    for (let attempt = 0; attempt < 100; attempt++) {
      if (child.exitCode !== null) throw Error("Fixture API exited " + child.exitCode);
      if ((await fetch(base + "/ready").catch(() => undefined))?.ok) return child;
      await Bun.sleep(50);
    }
    child.kill();
    throw Error("Fixture API did not become ready");
  };
  let server = await launch("interrupt");
  try {
    const registered = await fetch(base + "/account/register", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "fixture-" + crypto.randomUUID() + "@example.invalid", password: crypto.randomUUID() }) });
    expect(registered.status).toBe(201);
    const cookie = registered.headers.get("set-cookie")!.split(";")[0]!;
    const headers = { "content-type": "application/json", cookie };
    const project = await (await fetch(base + "/projects", { method: "POST", headers, body: JSON.stringify({ name: "Restart fixture" }) })).json();
    const url = base + "/sessions/" + project.session_id + "/site-runs";
    const run = await (await fetch(url, { method: "POST", headers, body: JSON.stringify({
      request_id: crypto.randomUUID(), url: "https://walkthrough.example.com/", max_depth: 3, approved: true, goal: "Tutor developers on packages", audience: "Developers",
    }) })).json();
    expect(run.status).toBe("queued");
    expect(await until_aborted(server.exited, AbortSignal.timeout(10_000))).toBe(0);
    const start = performance.now();
    server = await launch("recover");
    const get_run = async () => (await fetch(url + "/" + run.run_id, { headers })).json();
    const initial = await get_run();
    expect(initial.steps).toHaveLength(1);
    const screenshot_url = url + "/" + run.run_id + "/steps/1/screenshot";
    const image_digest = async () => Bun.hash(await (await fetch(screenshot_url, { headers })).arrayBuffer());
    const first_image = await image_digest();
    let result = initial;
    while (result.status === "running" || result.status === "queued") {
      if (performance.now() - start > 40_000) throw Error("The recovered worker did not complete in 40 seconds");
      await Bun.sleep(400);
      result = await get_run();
    }
    console.info("Fixture API restart elapsed ms", Math.round(performance.now() - start));
    expect(result.status).toBe("completed");
    expect(result.resumed).toBe(true);
    expect(result.run_id).toBe(run.run_id);
    expect(result.steps.map((step: { n: number }) => step.n)).toEqual([1, 2, 3]);
    expect(result.steps[0]).toEqual(initial.steps[0]);
    expect(await image_digest()).toEqual(first_image);
  } finally {
    if (server.exitCode === null) server.kill();
    await server.exited;
  }
}, 55_000);
