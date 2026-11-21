import { createHash } from "node:crypto";
import type { Request } from "express";
import { current_account } from "./account";
import { database } from "../repositories/store";

export const session_for = (req: Request) => {
  const session_id = req.params.session_id;
  const token = req.get("Authorization")?.match(/^Bearer ([\w-]+)$/)?.[1];
  if (typeof session_id !== "string") return null;
  const account = current_account(req);
  if (account && database().accounts.owns(account.id, session_id)) return session_id;
  if (!token) return null;
  const token_hash = createHash("sha256").update(token).digest("hex");
  return database().authorized(session_id, token_hash) ? session_id : null;
};
