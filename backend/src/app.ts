import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { Hono } from "hono";
import { chat } from "./routes/chat";

const app = new Hono();

app.use(
  "*",
  cors({ origin: process.env.CORS_ORIGIN ?? "http://localhost:3000" }),
);

app.get("/api/health", (c) => c.json({ status: "ok", runtime: typeof Bun === "undefined" ? "node" : "bun" }));

app.route("/", chat);
if (typeof Bun !== "undefined") {
  const { sessions } = await import("./routes/session");
  app.route("/", sessions);
}

app.notFound((c) => c.json({ error: "Not found" }, 404));
app.onError((error, c) => {
  if (error instanceof HTTPException) return c.json({ error: error.message }, error.status);
  console.error(error.name);
  return c.json({ error: "Internal server error" }, 500);
});

export default app;
