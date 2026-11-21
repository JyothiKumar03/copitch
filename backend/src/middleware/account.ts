import { createHash } from "node:crypto";
import type { Request } from "express";
import { database } from "../repositories/store";

export const cookie_name = "copitch_login";
export const token_digest = (token: string) => createHash("sha256").update(token).digest("hex");

export const login_digest = (req: Request) => {
  const value = req.get("cookie")?.split(";").map(cookie => cookie.trim()).find(cookie => cookie.startsWith(cookie_name + "="));
  const token = value?.slice(cookie_name.length + 1);
  return token && /^[\w-]{43}$/.test(token) ? token_digest(token) : null;
};

export const current_account = (req: Request) => {
  const digest = login_digest(req);
  return digest ? database().accounts.identity(digest) : null;
};

export const trusted_origin = (req: Request) => {
  const origin = req.get("origin");
  if (!origin) return true;
  if (origin === process.env.CORS_ORIGIN) return true;
  if (process.env.NODE_ENV !== "production" && origin === "http://localhost:3000") return true;
  try {
    const url = new URL(origin);
    return /^(https?:)$/.test(url.protocol) && url.host === req.get("host");
  } catch { return false; }
};
