import { randomBytes } from "node:crypto";

const child = Bun.spawn([process.execPath, "run", "--parallel", "dev:web", "dev:api", "dev:voice"], {
  stdin: "inherit", stdout: "inherit", stderr: "inherit",
  env: { ...process.env, VOICE_WORKER_TOKEN: process.env.VOICE_WORKER_TOKEN?.trim() || randomBytes(32).toString("base64url") },
});
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => child.kill(signal));
}
process.exitCode = await child.exited;
