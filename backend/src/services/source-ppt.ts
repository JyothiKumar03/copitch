import { execFile } from "node:child_process";
import { source_limits } from "../constants/sources";
import { AppError } from "../errors/app-error";
import { page_records } from "./source-pages";

export const read_ppt = async (bytes: Buffer) => {
  if (!bytes.subarray(0, 8).equals(Buffer.from("d0cf11e0a1b11ae1", "hex"))) {
    throw new AppError(422, "This file is not a legacy PowerPoint presentation.");
  }
  const directory = process.env.COPITCH_PPT_READER ?? "/opt/copitch/ppt";
  const output = await new Promise<string>((resolve, reject) => {
    const child = execFile(directory + "/bin/java", [
      "-Xmx96m", "-Djava.awt.headless=true", "-cp", directory + "/classes:" + directory + "/lib/*",
      "SlideText", String(source_limits.pages), String(source_limits.characters),
    ], { timeout: source_limits.timeout_ms, killSignal: "SIGKILL", maxBuffer: 256 * 1024,
      env: { LANG: "C.UTF-8" } }, (error, stdout) => {
      if (!error) return resolve(stdout);
      if (error.code === "ENOENT") return reject(new AppError(503, "The legacy PowerPoint reader is unavailable. Upload a .pptx copy."));
      reject(new AppError(422, "Could not read this PowerPoint. Supply a shorter, unlocked presentation."));
    });
    child.stdin?.on("error", () => { /* Process exit reports reader failure. */ });
    child.stdin?.end(bytes);
  });
  const slides = output.split(/\r?\n/).filter(line => line.startsWith("SLIDE\t"))
    .map(line => Buffer.from(line.slice(6), "base64").toString("utf8"));
  return page_records(slides, "slide");
};
