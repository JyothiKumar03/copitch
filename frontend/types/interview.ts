import type { TResearchSession } from "./research";

export type TGetSession = () => Promise<TResearchSession>;
export type TVoicePhase = "idle" | "requesting" | "recording" | "transcribing";
