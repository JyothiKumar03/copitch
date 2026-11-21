import { Router } from "express";
import { chat_reply } from "../controllers/chat";

export const chat = Router();
chat.post("/chat", chat_reply);
