import { createHash } from "node:crypto";
import type { RequestHandler } from "express";
import { AppError } from "../errors/app-error";
import { session_for } from "../middleware/host-session";
import { database } from "../repositories/store";
import { max_source_bytes, parse_source, source_kind } from "../services/source";

export const source_host: RequestHandler = (req,res,next) => {
  res.set("Cache-Control","private, no-store");
  const session = session_for(req);
  if (!session) throw new AppError(401,"Unauthorized");
  res.locals.host_session_id = session;
  next();
};

export const upload_source: RequestHandler = async (req,res) => {
  const type = req.get("Content-Type") ?? "";
  if (!/^multipart\/form-data\s*;/i.test(type)) throw new AppError(415,"Send a multipart file field");
  let form: Awaited<ReturnType<Response["formData"]>>;
  try { form = await new Response(req.body,{headers:{"Content-Type":type}}).formData(); }
  catch { throw new AppError(400,"Invalid multipart document"); }
  const file = form.get("file");
  if (!(file instanceof File) || form.getAll("file").length !== 1) throw new AppError(400,"Supply one document in the file field");
  if (file.size > max_source_bytes) throw new AppError(413,"File exceeds 8 MiB");
  const filename = file.name.split(/[\\/]/).at(-1)?.trim();
  if (!filename || filename.length > 200 || /[\r\n]/.test(filename)) throw new AppError(400,"Invalid filename");
  const bytes = Buffer.from(await file.arrayBuffer());
  const session = res.locals.host_session_id as string;
  const sources = database().sources;
  const call = sources.start_call(session, filename, source_kind(filename));
  try {
    const source = await parse_source(filename,bytes);
    const digest = createHash("sha256").update(filename).update("\0").update(bytes).digest("hex");
    res.status(201).json(sources.save(session, digest, source, call));
  } catch (error) {
    sources.fail_call(session, call, error instanceof AppError ? error.message : "Document processing failed. Attach it again.");
    throw error;
  }
};

export const source_calls: RequestHandler = (_req, res) => {
  res.json({ calls: database().sources.calls(res.locals.host_session_id) });
};
