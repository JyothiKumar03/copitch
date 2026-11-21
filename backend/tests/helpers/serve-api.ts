import { once } from "node:events";
import { createServer } from "node:http";
import type { Express } from "express";

export const serve_api = async (app: Express) => {
  const server = createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected a loopback test listener");
  const origin = "http://127.0.0.1:" + address.port;
  const close = () => new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections();
  });
  return { request: (path: string, init?: RequestInit) => fetch(origin + path, init), close, [Symbol.asyncDispose]: close };
};
