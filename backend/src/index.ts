import app from "./app";

const port = Number(process.env.PORT ?? 3001);

if (typeof Bun !== "undefined") {
  Bun.serve({ port, fetch: app.fetch });
  console.log(`API listening on http://localhost:${port} (Bun)`);
} else {
  const { serve } = await import("@hono/node-server");
  serve({ port, fetch: app.fetch });
  console.log(`API listening on http://localhost:${port} (Node)`);
}
