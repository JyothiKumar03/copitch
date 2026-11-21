import express, { Router } from "express";
import { interview_handlers } from "../controllers/interview";
import { studio_heard_handler, studio_turn_handler } from "../controllers/studio-turn";
import { AppError } from "../errors/app-error";
import { session_for } from "../middleware/host-session";
import { max_recording_bytes } from "../services/interview-voice";

export const create_interview_router = (fetch_worker: (url:string,options:RequestInit) => Promise<Response> = fetch, turn_handler = studio_turn_handler) => {
  const router = Router();
  const handlers = interview_handlers(fetch_worker);
  router.use("/:session_id/interview",(req,res,next) => {
    res.set("Cache-Control","private, no-store");
    const session = session_for(req);
    if (!session) throw new AppError(401,"Unauthorized");
    res.locals.host_session_id = session;
    next();
  });
  router.post("/:session_id/interview/start", handlers.start);
  router.post("/:session_id/interview/connect",
    express.raw({ type: "application/sdp", limit: 65536, inflate: false }), handlers.connect);
  router.post("/:session_id/interview/transcribe",
    express.raw({type:"multipart/form-data",limit:max_recording_bytes + 65536,inflate:false}),handlers.transcribe);
  router.post("/:session_id/interview/progress", express.json({ limit: 32768 }), handlers.progress);
  router.post("/:session_id/interview/turn", express.json({ limit: 262144 }), turn_handler);
  router.post("/:session_id/interview/heard", express.json({ limit: 1024 }), studio_heard_handler);
  router.post("/:session_id/interview/speech",
    express.raw({type:() => true,limit:16384,inflate:false}),handlers.speech);
  router.get("/:session_id/interview/workspace",handlers.workspace);
  return router;
};

export const interview = create_interview_router();
