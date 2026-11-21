import { password as passwords } from "bun";
import { randomBytes } from "node:crypto";
import type { Request, Response } from "express";
import { z } from "zod";
import { AppError } from "../errors/app-error";
import { cookie_name, current_account, login_digest, token_digest } from "../middleware/account";
import { database } from "../repositories/store";

const credentials = z.strictObject({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(256),
});
const project_input = z.strictObject({ name: z.string().trim().min(1).max(100) });
const login_lifetime = 7 * 24 * 60 * 60 * 1000;
const cookie_options = () => ({ httpOnly: true, sameSite: "lax" as const, path: "/api", secure: process.env.NODE_ENV === "production" });
const attempts = new Map<string, { count: number; until: number }>();

const read_credentials = (req: Request) => {
  const result = credentials.safeParse(req.body);
  if (!result.success) throw new AppError(400, "Enter a valid email and password.");
  const now = Date.now();
  for (const [key, entry] of attempts) if (entry.until <= now) attempts.delete(key);
  const address = req.ip ?? "unknown";
  const window = attempts.get(address) ?? { count: 0, until: now + 60_000 };
  if (++window.count > 60) throw new AppError(429, "Too many attempts. Try again in one minute.");
  attempts.set(address, window);
  return result.data;
};

const begin_login = (req: Request, res: Response, account_id: string, email: string) => {
  const token = randomBytes(32).toString("base64url");
  const accounts = database().accounts;
  const previous = login_digest(req);
  if (previous) accounts.logout(previous);
  accounts.login(token_digest(token), account_id, Date.now() + login_lifetime);
  res.cookie(cookie_name, token, { ...cookie_options(), maxAge: login_lifetime }).json({ email });
};

export const register_account = async (req: Request, res: Response) => {
  const { email, password } = read_credentials(req);
  if (password.length < 12) throw new AppError(400, "Use a password with at least 12 characters.");
  const id = crypto.randomUUID();
  const hash = await passwords.hash(password, { algorithm: "argon2id", memoryCost: 19456, timeCost: 2 });
  if (!database().accounts.register(id, email, hash)) throw new AppError(409, "Unable to create that account. Try signing in.");
  res.status(201);
  begin_login(req, res, id, email);
};

export const sign_in = async (req: Request, res: Response) => {
  const { email, password } = read_credentials(req);
  const account = database().accounts.account(email);
  if (!account || !await passwords.verify(password, account.password_hash)) throw new AppError(401, "Incorrect email or password.");
  begin_login(req, res, account.id, account.email);
};

export const sign_out = (req: Request, res: Response) => {
  const token = login_digest(req);
  if (token) database().accounts.logout(token);
  res.clearCookie(cookie_name, cookie_options()).sendStatus(204);
};

export const list_projects = (req: Request, res: Response) => {
  const account = current_account(req);
  if (!account) throw new AppError(401, "Sign in to open your projects.");
  res.json({ email: account.email, projects: database().accounts.list(account.id) });
};

const legacy_input = project_input.extend({ session_id: z.uuid(), token: z.string().regex(/^[\w-]{43}$/) });

export const import_project = (req: Request, res: Response) => {
  const account = current_account(req);
  if (!account) throw new AppError(401, "Sign in to import a session.");
  const input = legacy_input.safeParse(req.body);
  if (!input.success) throw new AppError(400, "Invalid saved session.");
  const { session_id, token, name } = input.data;
  const accounts = database().accounts;
  if (accounts.owns(account.id, session_id)) return res.json({ session_id, name });
  const project = accounts.claim_project(account.id, session_id, token_digest(token), name);
  if (!project) throw new AppError(403, "This session cannot be imported.");
  res.status(201).json(project);
};

export const create_project = (req: Request, res: Response) => {
  const account = current_account(req);
  if (!account) throw new AppError(401, "Sign in to create a project.");
  const input = project_input.safeParse(req.body);
  if (!input.success) throw new AppError(400, "Give your project a name of up to 100 characters.");
  res.status(201).json(database().accounts.create_project(account.id, input.data.name));
};
