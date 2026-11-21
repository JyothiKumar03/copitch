export const LIVE_EXCHANGE_IDLE_MS = 2500;
export const LIVE_BACKCHANNEL_MS = 1500;

// The provider's last host token can arrive across a small gap while the first reply is already streaming.
export const LIVE_HOST_TAIL_GAP_MS = 400;
export const isLiveHostTail = (start: number | undefined, hostEnd: number | undefined, replyEnd: number | undefined,
  maxGapMs = LIVE_HOST_TAIL_GAP_MS) =>
  start !== undefined && hostEnd !== undefined && replyEnd !== undefined && start <= replyEnd && start - hostEnd <= maxGapMs;
