export type TAudioFrame = { mic: Float32Array; speaker: Float32Array };
export type TGateEvent = { kind: "onset" | "feedback" } | { kind: "end"; frames: Float32Array[] };
export type THandsFreeOptions = { onFinal: (text: string) => void; suspended?: boolean };
export type THandsFreeCapture = {
  attachPlayer: (audio: HTMLAudioElement) => () => void;
  reset: () => void;
  close: () => void;
};
export type TCaptureCallbacks = {
  blocked: () => boolean;
  playing: () => boolean;
  onStart: () => void;
  onEnd: (audio: Blob) => void;
  onFailure: (message: string) => void;
};
