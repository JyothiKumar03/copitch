import manifest from "./languages.json";

export const LANGUAGE_OPTIONS = manifest.languages;
export type TInterviewLanguage = keyof typeof LANGUAGE_OPTIONS;
export const isInterviewLanguage = (value: unknown): value is TInterviewLanguage =>
  typeof value === "string" && Object.hasOwn(LANGUAGE_OPTIONS, value);

if (!isInterviewLanguage(manifest.default_language)) throw new Error("Unsupported default interview language");
export const DEFAULT_LANGUAGE: TInterviewLanguage = manifest.default_language;
