import { SessionStore } from "./session";

let store: SessionStore | undefined;

export const database = () => store ??= new SessionStore(process.env.AI_SESSION_DB ?? "./data/ai-sessions.sqlite");
