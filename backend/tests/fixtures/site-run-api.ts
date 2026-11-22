import { open_site_browser } from "../../src/services/site-browser";
import { run_site_agent } from "../../src/services/site-agent";
import { SiteRunWorker } from "../../src/workers/site-run";
import { database } from "../../src/repositories/store";
import { create_site_routes } from "../../src/routes/site-run";
import { api_error } from "../../src/middleware/api-error";

const [sqlite, port, mode] = process.argv.slice(2);
if (!sqlite || !port || !["interrupt", "recover"].includes(mode)) throw Error("Expected a temporary database, port, and fixture mode");
process.env.AI_SESSION_DB = sqlite;
const { default: app, create_api } = await import("../../src/app");
const pages: Record<string, string> = {
  "/": '<h1>Development guide</h1><p>The guide explains how to install a package.</p><a href="/tutorial">Tutorial</a>',
  "/tutorial": '<h1>Development tutorial</h1><p>Open a project and create a virtual environment.</p><a href="/tutorial/packages">Packages</a>',
  "/tutorial/packages": '<h1>Packages</h1><p>Install dependencies in your virtual environment.</p>',
};

const worker = new SiteRunWorker(database, (lease, signal, commit) => run_site_agent(lease, signal, (state, image) => {
  commit(state, image);
  if (mode === "interrupt" && image) process.exit(0);
}, { open: (root, stop) => open_site_browser(root, stop, {
  resolve: async host => {
    if (host !== "walkthrough.example.com") throw Error("Unexpected fixture host");
    return ["93.184.215.14"];
  },
  read: async (url, _pin, _limit, read_signal) => {
    if (url.hostname !== "walkthrough.example.com") throw Error("Unexpected fixture request");
    if (lease.goal === "Pause for Stop" && url.pathname !== "/") {
      await new Promise<void>((_, reject) => { read_signal.addEventListener("abort", () => reject(read_signal.reason), { once: true }); });
    }
    return { url: url.href, status: pages[url.pathname] ? 200 : 404, content_type: "text/html",
      body: Buffer.from("<!doctype html><title>Guide</title><main>" + (pages[url.pathname] ?? "") + "</main>") };
  } }),
}));
const fixture = create_api();
fixture.use("/api/sessions", create_site_routes(worker));
fixture.use(app);
fixture.use(api_error);
worker.start();
fixture.listen(Number(port), "127.0.0.1", () => console.log("Fixture listening"));
