import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { SiteRunRepository } from "../src/repositories/site-run";
import { site_element_wall } from "../src/services/site-policy";
import { SiteRunWorker } from "../src/workers/site-run";
import { SessionStore } from "../src/repositories/session";
import { initial_site_checkpoint, run_site_agent } from "../src/services/site-agent";
import type { TSiteDecider } from "../src/services/site-agent";
import { open_site_browser } from "../src/services/site-browser";
import { until_aborted } from "../src/services/website-capture";
import type { TSiteLease, TSiteObservation } from "../src/types/site-run";
import type { TSiteRunInput } from "../../shared/site-run";

const root = "https://walkthrough.example.com/";
const input: TSiteRunInput = { request_id: crypto.randomUUID(), url: root, approved: true, goal: "Learn the tutorial and library", audience: "Developers", max_depth: 3 };
const lease_for = (budget_usd = 2): TSiteLease => ({ ...input, run_id: crypto.randomUUID(), lease_token: crypto.randomUUID(),
  engine: "model", created_at: Date.now(), budget_usd, checkpoint: initial_site_checkpoint(root) });

test("guarded Chromium records a deep public branch, then covers remaining branches without executing blocked actions", async () => {
  const hits: string[] = [];
  const secret = "fixture-private-field-2893";
  const fixture: Record<string, string> = {
    "/": '<h1>Developer resources</h1><a href="/tutorial">Tutorial</a><a href="/library">Library</a>' +
      '<a href="https://elsewhere.example.org">Elsewhere</a><button onclick="document.body.innerHTML=\'deleted\'">Delete account</button>' +
      '<a href="/checkout">Checkout</a><a href="/gate">Continue</a><a href="/member">Member tools</a><a href="/missing">Other section</a>',
    "/tutorial": '<h1>Tutorial</h1><a href="/tutorial/setup">Learn setup</a>',
    "/tutorial/setup": '<h1>Project setup</h1><p>Install project dependencies in an isolated virtual environment.</p>' +
      '<p>On Windows, run:</p><pre>tutorial-env\\Scripts\\activate</pre><p>On Unix or MacOS, run:</p><pre>source tutorial-env/bin/activate</pre>',
    "/library": '<h1>Library reference</h1><p>Find an API by module.</p>',
    "/gate": '<h1>Verify you are human</h1>',
    "/member": '<h1>Members</h1><input type="password" value="' + secret + '">',
  };
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: request => {
    const path = new URL(request.url).pathname;
    hits.push(path);
    return new Response('<!doctype html><title>Fixture documentation</title><main>' + (fixture[path] ?? "") + "</main>",
      { status: fixture[path] ? 200 : 404, headers: { "Content-Type": "text/html" } });
  } });
  const observations: TSiteObservation[] = [];
  const images: Buffer[] = [];
  const decider: TSiteDecider = { model: "fixture", reserve_usd: 0.02, choose: async ({ observation, frontier }) => {
    observations.push(observation);
    if (observations.length === 1) return { action: { kind: "click", ref: observation.elements.find(el => el.name === "Delete account")!.ref }, spend_usd: 0.01 };
    if (observations.length === 2) return { action: { kind: "click", ref: "e999" }, spend_usd: 0.01 };
    const next = frontier.find(entry => entry.url.endsWith("/tutorial/setup")) ?? frontier[0];
    return { action: next ? { kind: "navigate", url: next.url } : { kind: "finish", goal_met: true }, spend_usd: 0.01 };
  } };
  try {
    const { checkpoint } = await run_site_agent(lease_for(), AbortSignal.timeout(30_000), (_, image) => { if (image) images.push(image.bytes); }, {
      decider, open: (site, signal) => open_site_browser(site, signal, { resolve: async () => ["93.184.215.14"],
        read: async (url, pin) => {
          expect(pin).toBe("93.184.215.14");
          expect(url.origin).toBe(new URL(root).origin);
          const response = await fetch(new URL(url.pathname, server.url));
          return { url: url.href, content_type: "text/html", status: response.status, body: Buffer.from(await response.arrayBuffer()) };
        } }),
    });
    expect(checkpoint.steps.map(s => new URL(s.url).pathname)).toEqual(["/", "/tutorial", "/tutorial/setup", "/library"]);
    expect(checkpoint.steps[2].facts).toContain("Install project dependencies in an isolated virtual environment.");
    expect(checkpoint.steps[2].facts).toContain("On Windows, run: tutorial-env\\Scripts\\activate");
    expect(checkpoint.steps[2].facts).toContain("On Unix or MacOS, run: source tutorial-env/bin/activate");
    expect(new Set(checkpoint.walls.map(w => w.kind))).toEqual(new Set(["off_site", "skipped_consequential", "payment", "bot_check", "needs_account", "dead_end", "unavailable"]));
    expect(hits).not.toContain("/checkout");
    expect(images.length).toBe(4);
    expect(images.every(bytes => bytes.readUInt16BE() === 0xffd8)).toBe(true);
    expect(JSON.stringify(checkpoint)).not.toContain(secret);
    expect(observations.every(({ facts, elements, url }) => !JSON.stringify({ facts, elements, url }).includes(secret))).toBe(true);
    expect(checkpoint.receipts?.every(receipt => receipt.status === "completed")).toBe(true);
  } finally { await server.stop(true); }
}, 40_000);

test("budget preserves a partial result, charges unknown usage conservatively, and avoids another dispatch", async () => {
  const lease = lease_for(0.2);
  lease.checkpoint.spent_usd = 0.13;
  const observed: TSiteObservation = { url: root, title: "Starting page", screenshot: Buffer.from("fixture"), elements: [],
    facts: ["The starting page is accessible."], password_field: false, payment_field: false, challenge: false };
  let calls = 0;
  const result = await run_site_agent(lease, AbortSignal.timeout(1_000), () => {}, {
    open: async () => ({ open: async () => {}, observe: async () => observed, click: async () => {}, select: async () => {},
      scroll: async () => {}, close: async () => {} }),
    decider: { model: "fixture-priced", reserve_usd: 0.06, choose: async () => {
      calls++;
      return { action: { kind: "record_step", facts: [0] }, spend_usd: null };
    } },
  });
  expect(calls).toBe(1);
  expect(result.checkpoint.steps).toHaveLength(1);
  expect(result.summary).toContain("spending limit");
  expect(result.checkpoint.spent_usd).toBe(0.19);
  expect(result.checkpoint.receipts?.[0]).toMatchObject({ status: "completed", estimated: true, priced_usd: 0.06 });
});

test("reopening SQLite recovers one step and image under the same ID, and fences a stale lease", () => {
  const path = join(mkdtempSync(join(tmpdir(), "site-run-checkpoint-")), "fixture.sqlite");
  const first_db = new Database(path, { create: true });
  const first = new SiteRunRepository(first_db);
  const started = first.enqueue("host", input, 2, "browser", 1000);
  const lease = first.claim(1001)!;
  const state = lease.checkpoint;
  state.steps.push({ n: 1, depth: 0, url: root, title: "Setup", facts: ["Setup fact"], caption: "Opened setup" });
  expect(first.checkpoint(lease, state, { n: 1, bytes: Buffer.from("fixture image") }, 1002)).toBe(true);
  first_db.close();
  const second_db = new Database(path);
  const second = new SiteRunRepository(second_db);
  try {
    const recovered = second.claim(27_000)!;
    expect(recovered.run_id).toBe(started.run_id);
    expect(second.get("host", started.run_id)).toMatchObject({ resumed: true, steps: state.steps });
    expect(second.checkpoint(lease, state, undefined, 27_001)).toBe(false);
    expect(Buffer.from(second.screenshot("host", started.run_id, 1)!).toString()).toBe("fixture image");
    expect(second.screenshot("different-host", started.run_id, 1)).toBeUndefined();
  } finally { second_db.close(); }
});

test("an expired terminal checkpoint restores the outcome even after the last execution lease", () => {
  const db = new Database(":memory:");
  const repo = new SiteRunRepository(db);
  try {
    const started = repo.enqueue("host", input, 2, "model", 1000);
    const first = repo.claim(1001)!;
    const final = repo.claim(26_002)!;
    expect(final.run_id).toBe(first.run_id);
    const done = final.checkpoint;
    const screenshot = Buffer.from("saved frame");
    done.steps.push({ n: 1, depth: 0, url: root, title: "Setup", facts: ["Setup fact"], caption: "Opened setup" });
    done.spent_usd = 0.03;
    done.goal_met = true;
    done.final_summary = "The recorded screens cover the requested goal.";
    expect(repo.checkpoint(final, done, { n: 1, bytes: screenshot }, 26_003)).toBe(true);
    expect(repo.claim(51_001)).toBeUndefined();
    expect(repo.get("host", started.run_id)?.status).toBe("running");
    expect(repo.claim(51_003)).toBeUndefined();
    expect(repo.get("host", started.run_id)).toMatchObject({ status: "completed", engine: "model", goal_met: true,
      resumed: true, summary: done.final_summary, spent_usd: done.spent_usd, steps: done.steps });
    expect(Buffer.from(repo.screenshot("host", started.run_id, 1)!)).toEqual(screenshot);

    const blocked = repo.enqueue("host", { ...input, request_id: crypto.randomUUID() }, 2, "browser", 51_004);
    const no_pages = repo.claim(51_004)!;
    no_pages.checkpoint.final_summary = "No usable pages were recorded.";
    expect(repo.checkpoint(no_pages, no_pages.checkpoint, undefined, 51_005)).toBe(true);
    expect(repo.claim(76_005)).toBeUndefined();
    expect(repo.get("host", blocked.run_id)).toMatchObject({ status: "failed", goal_met: false, resumed: true,
      summary: "No usable pages were recorded." });
  } finally { db.close(); }
});

test("Stop interrupts an active browser operation within one second and rolls back a failed source attachment", async () => {
  const db = new SessionStore(":memory:");
  const started = db.site_runs.enqueue("host", input, 2, "browser");
  const ready = Promise.withResolvers<void>();
  let observed_stop = false;
  const worker = new SiteRunWorker(() => db, async (lease, signal, commit) => {
    lease.checkpoint.steps.push({ n: 1, depth: 0, url: root, title: "Setup", facts: ["Setup fact"], caption: "Opened setup" });
    commit(lease.checkpoint, { n: 1, bytes: Buffer.from("fixture image") });
    ready.resolve();
    try { await until_aborted(new Promise<void>(() => {}), signal); }
    finally { observed_stop = true; }
    return { checkpoint: lease.checkpoint, summary: "Done" };
  });
  const finished = worker.tick();
  await ready.promise;
  const start = performance.now();
  db.site_runs.stop("host", started.run_id);
  worker.stop(started.run_id);
  await finished;
  const elapsed = performance.now() - start;
  console.info("Site run Stop elapsed ms", elapsed.toFixed(2));
  expect(elapsed).toBeLessThan(1000);
  expect(observed_stop).toBe(true);
  expect(db.site_runs.get("host", started.run_id)?.status).toBe("stopped");
  const source = { source_id: started.run_id, filename: "Fixture", kind: "web_flow" as const, locations: 1, records: [{ number: 1, text: "Setup fact" }], gaps: [] };
  expect(() => db.site_runs.attach_source("host", started.run_id, () => {
    db.sources.save("host", "fixture", source);
    throw new Error("Scope conflict");
  })).toThrow("Scope conflict");
  expect(() => db.sources.selected("host", [started.run_id])).toThrow("Unknown research source");
  const attach = () => db.site_runs.attach_source("host", started.run_id, () => db.sources.save("host", "fixture", source));
  expect(attach()).toEqual(attach());
  expect(db.sources.selected("host", [started.run_id])).toHaveLength(1);
});


test("documentation about account-related APIs stays reachable while actual account controls are guarded", () => {
  for (const name of ["copyreg — Register pickle support functions", "getpass — Portable password input", "atexit.register()", "functools — Higher-order functions", "6.16. Evaluation order"]) {
    expect(site_element_wall({ ref: "e1", role: "link", enabled: true, name })).toBeUndefined();
  }
  expect(site_element_wall({ ref: "e2", role: "button", enabled: true, name: "Sign in" })).toBe("needs_account");
  expect(site_element_wall({ ref: "e4", role: "link", enabled: true, name: "Place order" })).toBe("skipped_consequential");
  expect(site_element_wall({ ref: "e3", role: "button", enabled: true, name: "Delete account" })).toBe("skipped_consequential");
});

test("failed provider calls retain a single receipt and the next visible branch can finish safely", async () => {
  const lease = lease_for(1);
  let page_url = root;
  let calls = 0;
  const result = await run_site_agent(lease, AbortSignal.timeout(1_000), () => {}, {
    open: async () => ({ open: async value => { page_url = value; }, observe: async () => ({
      url: page_url, title: "Guide", facts: [page_url === root ? "Choose a branch." : "The library lists the APIs."],
      screenshot: Buffer.from("fixture"), password_field: false, payment_field: false, challenge: false,
      elements: page_url === root ? [{ ref: "e1", name: "Library", role: "link", href: root + "library", enabled: true }] : [],
    }), click: async () => {}, select: async () => {}, scroll: async () => {}, close: async () => {} }),
    decider: { model: "fixture-priced", pricing_version: "test", reserve_usd: 0.20, choose: async () => {
      if (++calls === 1) throw Error("Provider unavailable");
      return { action: { kind: "finish", goal_met: true }, spend_usd: 0.01, attempt: {
        provider: "openai", model: "fixture-priced", outcome: "completed", pricing_version: "test", estimated_usd: 0.01,
        usage: { input_tokens: 111, output_tokens: 12 },
      } };
    } },
  });
  expect(result.checkpoint.steps.map(s => s.url)).toEqual([root, root + "library"]);
  expect(result.checkpoint.spent_usd).toBeCloseTo(0.21);
  expect(result.checkpoint.usage_estimated).toBe(true);
  expect(result.checkpoint.receipts).toMatchObject([
    { n: 1, model: "fixture-priced", status: "failed", priced_usd: 0.20, estimated: true },
    { n: 2, model: "fixture-priced", status: "completed", priced_usd: 0.01, estimated: false, input_tokens: 111, output_tokens: 12 },
  ]);
});

test("a failed model action checks unseen examples on the current page before leaving it", async () => {
  const guide = root + "venv";
  const activation = "tutorial-env\\Scripts\\activate";
  const install = "python -m pip install requests";
  let url = root;
  let example = "";
  const shown: string[] = [];
  const lease = { ...lease_for(), goal: "Show how to activate a virtual environment and install a dependency with pip" };
  const { checkpoint } = await run_site_agent(lease, AbortSignal.timeout(1_000), () => {}, {
    open: async () => ({ open: async value => { url = value; }, observe: async () => ({
      url, title: "Developer guide", facts: url === root ? ["Choose a guide."] : example ? [install] : [`On Windows, run: ${activation}`],
      elements: url === root ? [{ ref: "e1", name: "Virtual environments", role: "link", href: guide, enabled: true }] : [],
      examples: url === guide ? [{ ref: "x1", text: activation }, { ref: "x2", text: install }] : [],
      screenshot: Buffer.from("frame"), password_field: false, payment_field: false, challenge: false,
    }), click: async () => {}, select: async () => {}, scroll: async () => {}, close: async () => {},
    show_example: async ref => { shown.push(ref); example = ref; }, }),
    decider: { model: "fixture", reserve_usd: 0.02, choose: async ({ observation, recorded }) => {
      if (observation.url === root) return { action: { kind: "navigate", url: guide }, spend_usd: 0.01 };
      if (recorded.length === 2) throw new Error("Model temporarily unavailable");
      return { action: { kind: "finish", goal_met: false }, spend_usd: 0.01 };
    } },
  });
  expect(shown).toEqual(["x2"]);
  expect(checkpoint.steps.flatMap(step => step.facts)).toContain(install);
  expect(checkpoint.receipts?.map(receipt => receipt.status)).toEqual(["completed", "failed", "completed"]);
  expect(checkpoint.spent_usd).toBeCloseTo(0.04);
});

test("an exhausted branch allowance samples another branch before dispatching the model again", async () => {
  const lease = lease_for(1);
  let page_url = root;
  const calls: string[] = [];
  const result = await run_site_agent(lease, AbortSignal.timeout(1000), () => {}, {
    open: async () => ({ open: async value => { page_url = value; }, observe: async () => ({
      url: page_url, title: "Fixture", facts: ["Page " + page_url], screenshot: Buffer.from("frame"),
      password_field: false, payment_field: false, challenge: false,
      elements: (page_url === root ? ["library", "tutorial"] : page_url.endsWith("/library") ? ["library/more"] : [])
        .map((path, i) => ({ ref: "e" + (i + 1), name: path, enabled: true, role: "link", href: root + path })),
    }), click: async () => {}, select: async () => {}, scroll: async () => {}, close: async () => {} }),
    decider: { model: "fixture-priced", reserve_usd: 0.30, choose: async ({ observation }) => {
      calls.push(observation.url);
      if (observation.url === root) return { action: { kind: "navigate", url: root + "library" }, spend_usd: 0.01 };
      if (observation.url.endsWith("/library")) return { action: { kind: "record_step", facts: [0] }, spend_usd: 0.25 };
      return { action: { kind: "finish", goal_met: true }, spend_usd: 0.01 };
    } },
  });
  expect(calls).toEqual([root, root + "library", root + "tutorial"]);
  expect(result.checkpoint.branch_spend[root + "library"]).toBe(0.25);
  expect(result.checkpoint.steps.map(s => s.url)).toEqual([...calls, root + "library/more"]);
  expect(result.checkpoint.goal_met).toBe(false);
});

test("a proposed finish needs independently reviewed evidence before the crawl can claim completion", async () => {
  const destination = root + "create";
  const lease = { ...lease_for(), goal: "Show how a customer creates a project and exports the result" };
  let page_url = root;
  const review_calls: string[][] = [];
  const visited: string[] = [];
  let completed_review = lease.checkpoint;
  const result = await run_site_agent(lease, AbortSignal.timeout(1_000), state => {
    if (state.receipts?.length === 4 && state.receipts[3].status === "completed") completed_review = structuredClone(state);
  }, {
    open: async () => ({ open: async value => { page_url = value; visited.push(value); }, observe: async () => ({
      url: page_url, title: "Project guide", screenshot: Buffer.from("frame"), password_field: false, payment_field: false, challenge: false,
      facts: [page_url === root ? "Welcome to the product." : "Choose New Project, give it a name, then choose Export to save the result."],
      elements: page_url === root ? [{ ref: "e1", name: "Create a project", role: "link", href: destination, enabled: true }] : [],
    }), click: async () => {}, select: async () => {}, scroll: async () => {}, close: async () => {} }),
    decider: { model: "fixture-priced", reserve_usd: 0.02,
      choose: async () => ({ action: { kind: "finish", goal_met: true }, spend_usd: 0.01 }),
      review: async ({ recorded }) => {
        review_calls.push(recorded.flatMap(step => step.facts));
        // A confident output with an unknown step number cannot close the run.
        return { verdict: { goal_met: true, steps: [recorded.length === 1 ? 99 : 2] }, spend_usd: 0.005 };
      },
    },
  });
  expect(visited).toEqual([root, destination]);
  expect(review_calls).toEqual([["Welcome to the product."], ["Welcome to the product.", "Choose New Project, give it a name, then choose Export to save the result."]]);
  expect(result.checkpoint.goal_met).toBe(true);
  expect(result.checkpoint.activity.map(item => item.label)).toContain("The recorded facts did not yet verify the full goal.");
  expect(result.checkpoint.activity.map(item => item.label)).toContain("Verified the goal against recorded website facts.");
  expect(result.checkpoint.spent_usd).toBeCloseTo(0.03);
  expect(Object.values(result.checkpoint.branch_spend).reduce((total, price) => total + price, 0)).toBeCloseTo(0.02);
  expect(result.checkpoint.receipts?.map(receipt => receipt.priced_usd)).toEqual([0.01, 0.005, 0.01, 0.005]);
  const resumed = await run_site_agent({ ...lease, checkpoint: completed_review }, AbortSignal.timeout(1_000), () => {}, {
    open: async () => { throw new Error("A settled, verified result must restore without reopening the browser."); },
  });
  expect(resumed).toEqual(result);
});

test("an unchanged review is not billed again after resume, and unaffordable verification leaves partial evidence", async () => {
  const open = async () => ({ open: async () => {}, observe: async () => ({ url: root, title: "Welcome",
    facts: ["Welcome to the product."], elements: [], screenshot: Buffer.from("frame"), password_field: false, payment_field: false, challenge: false,
  }), click: async () => {}, select: async () => {}, scroll: async () => {}, close: async () => {} });
  let review_calls = 0;
  const decider: TSiteDecider = { model: "fixture-priced", reserve_usd: 0.04,
    choose: async () => ({ action: { kind: "finish", goal_met: true }, spend_usd: 0.03 }), review: async () => {
      review_calls++;
      return { verdict: { goal_met: false, steps: [] }, spend_usd: 0.01 };
    },
  };
  const lease = lease_for(0.1);
  lease.checkpoint.spent_usd = 0.04;
  const limited = await run_site_agent(lease, AbortSignal.timeout(1_000), () => {}, { open, decider });
  expect(limited.checkpoint.goal_met).toBe(false);
  expect(limited.checkpoint.steps).toHaveLength(1);
  expect(limited.summary).toContain("spending limit");
  expect(review_calls).toBe(0);

  const durable = lease_for();
  let saved = durable.checkpoint;
  await run_site_agent(durable, AbortSignal.timeout(1_000), state => {
    if (!state.final_summary) saved = structuredClone(state);
  }, { open, decider });
  expect(saved.goal_reviews).toHaveLength(1);
  const resumed = await run_site_agent({ ...durable, checkpoint: saved }, AbortSignal.timeout(1_000), () => {}, { open, decider });
  expect(review_calls).toBe(1);
  expect(resumed.checkpoint.goal_met).toBe(false);
  expect(resumed.checkpoint.steps).toHaveLength(1);
});

test("screen cap is reported with all thirty distinct screenshots and an unexplored frontier", async () => {
  const lease = lease_for();
  let page_url = root;
  const count = 37;
  const images: number[] = [];
  const result = await run_site_agent(lease, AbortSignal.timeout(2000), (_, image) => { if (image) images.push(image.n); }, {
    open: async () => ({ open: async value => { page_url = value; }, observe: async () => ({
      url: page_url, title: "Page " + page_url, facts: ["Observed page " + page_url], screenshot: Buffer.from("frame"),
      password_field: false, payment_field: false, challenge: false,
      elements: page_url === root ? Array.from({ length: count }, (_, i) =>
        ({ ref: "e" + (i + 1), role: "link", enabled: true, name: "Library " + i, href: root + "library/" + i })) : [],
    }), click: async () => {}, select: async () => {}, scroll: async () => {}, close: async () => {} }),
    decider: { model: "fixture-priced", reserve_usd: 0.001, choose: async ({ frontier }) => ({
      action: { kind: "navigate", url: frontier[0]!.url }, spend_usd: 0.001,
    }) },
  });
  expect(result.checkpoint.steps).toHaveLength(30);
  expect(new Set(images).size).toBe(30);
  expect(result.checkpoint.frontier).toHaveLength(8);
  expect(result.summary).toContain("limit of 30 recorded screens");
});
