import type { TResearchSession } from "./research";

export type TGetSession = () => Promise<TResearchSession>;
export type TRecordingPhase = "idle" | "requesting" | "recording" | "transcribing";
