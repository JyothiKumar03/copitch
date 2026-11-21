import { Hono } from "hono";
import { chat_reply } from "../controllers/chat";

export const chat = new Hono();
chat.post("/api/chat", chat_reply);
