import type { Request } from "express";

export type TApiRequest = Request<Record<string, string>, unknown, unknown>;
