// Offline browser contract test. Start with an already-authorized intent.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { apply_continuation, create_continuation, next_continuation } from "../../backend/src/services/continuation";
import type { TContinuationAction, TContinuationRole } from "../../backend/src/types/continuation";

const browser = await chromium.launch({ channel: process.env.DECK_BROWSER_CHANNEL || undefined });
const intent = { link: "Getting started", target: "Setup", requires_public_access: true };
try {
  for (const variant of ["public", "login", "obscured"] as const) {
    let state = create_continuation("fixture", 1, [
      { point_id: "setup", requirement: "either" },
      { point_id: "pricing", requirement: "spoken" },
    ]);
    const send = (role: TContinuationRole, action: TContinuationAction) => {
      state = apply_continuation(state, role, { session_id: "fixture", expected_revision: 1,
        event_id: crypto.randomUUID(), generation: state.generation, action });
    };
    const ctx = await browser.newContext();
    try {
      await ctx.route("**/*", route => {
        const u = new URL(route.request().url());
        if (u.origin !== "http://product.test") return route.abort();
        const landing = '<a href="/start">Getting started</a>';
        const setup = '<h1>Setup</h1><p>Connect your first workspace.</p>';
        const overlay = '<div style="position:fixed;inset:0;background:white">An overlay covers setup</div>';
        return route.fulfill({ contentType: "text/html", body: u.pathname === "/" ? landing :
          variant === "login" ? '<h1>Sign in</h1><input aria-label="Password" type="password">' :
          setup + (variant === "obscured" ? overlay : "") });
      });
      const worker = await ctx.newPage();
      const stage = await ctx.newPage();
      await stage.setContent("<main>Setup slide</main>");
      send("host", { kind: "play", point_id: "setup", attempt_id: "first", asset_id: "setup-audio" });
      send("host", { kind: "interrupt", attempt_id: "first" });
      send("host", { kind: "prepare", point_id: "setup", attempt_id: "tour" });
      await worker.goto("http://product.test/");
      const link = worker.getByRole("link", { name: intent.link, exact: true });
      assert.equal(await link.count(), 1);
      await link.click();
      const heading = worker.getByRole("heading", { name: intent.target, exact: true });
      if (intent.requires_public_access && await worker.getByLabel("Password").isVisible()) {
        send("worker", { kind: "observed", attempt_id: "tour", outcome: "login" });
      } else {
        assert.equal(await heading.count(), 1);
        await heading.scrollIntoViewIfNeeded();
        const exposed = await heading.evaluate(el => {
          const r = el.getBoundingClientRect();
          const top = document.elementFromPoint(r.x + r.width/2, r.y + r.height/2);
          return !!top && el.contains(top);
        });
        if (!exposed) {
          send("worker", { kind: "observed", attempt_id: "tour", outcome: "obscured" });
        } else {
          const bytes = await worker.screenshot();
          const frame_id = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
          send("worker", { kind: "observed", attempt_id: "tour", outcome: "setup", frame_id });
          assert.deepEqual(next_continuation(state), { kind: "speak", point_id: "setup" });
          await stage.bringToFront();
          const visible = await stage.evaluate(async (image) => {
            const img = new Image();
            img.src = image;
            await img.decode();
            img.style.maxWidth = "100%";
            document.querySelector("main")!.replaceChildren(img);
            await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
            return document.visibilityState === "visible" && img.getBoundingClientRect().width > 0;
          }, "data:image/png;base64," + bytes.toString("base64"));
          send("stage", { kind: "paint", attempt_id: "tour", frame_id, visible });
        }
      }
      const next = next_continuation(state);
      assert.deepEqual(next, { kind: "speak", point_id: variant === "public" ? "pricing" : "setup" });
      assert.equal(state.points[0].spoken, "partial");
      if (variant !== "public") assert.equal(await stage.locator("main").innerText(), "Setup slide");
      console.log(variant, "→", next.point_id, "(interrupted speech remains partial)");
    } finally { await ctx.close(); }
  }
} finally { await browser.close(); }
