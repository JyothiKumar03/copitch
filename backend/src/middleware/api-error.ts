import type { ErrorRequestHandler } from "express";
import { AppError } from "../errors/app-error";

export const api_error: ErrorRequestHandler = (error: unknown, _req, res, next) => {
  if (res.headersSent) return next(error);
  if (error instanceof AppError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  if (error && typeof error === "object" && "type" in error) {
    if (error.type === "entity.too.large") {
      res.status(413).json({ error: "Request body exceeds the size limit" });
      return;
    }
    if (error.type === "entity.parse.failed") {
      res.status(400).json({ error: "Invalid JSON body" });
      return;
    }
    if (error.type === "charset.unsupported" || error.type === "encoding.unsupported") {
      res.status(415).json({ error: "Unsupported request encoding" });
      return;
    }
  }
  console.error(error instanceof Error ? error.name : "Unexpected API error");
  res.status(500).json({ error: "Internal server error" });
};
