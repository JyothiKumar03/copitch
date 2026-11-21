"use client";

import { useEffect } from "react";
import { reportStagePaint } from "@/lib/presentation";
import type { TStagePaint } from "@/types/presentation";

export const useStagePaint = (token: string | undefined, paint: TStagePaint | undefined) => {
  const sequence = paint?.sequence;
  const revision = paint?.revision;
  const slideId = paint?.slide_id;
  useEffect(() => {
    if (!token || !sequence || !revision || !slideId) return;
    const abort = new AbortController();
    let frame = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inFlight = false;
    const painted = () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      if (document.visibilityState !== "visible" || abort.signal.aborted || inFlight) return;
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => {
          if (document.visibilityState !== "visible" || abort.signal.aborted) return;
          inFlight = true;
          void reportStagePaint(token, { sequence, revision, slide_id: slideId }, abort.signal)
            .catch(() => {})
            .finally(() => {
              inFlight = false;
              if (!abort.signal.aborted && document.visibilityState === "visible") timer = setTimeout(painted, 2000);
            });
        });
      });
    };
    document.addEventListener("visibilitychange", painted);
    painted();
    return () => {
      abort.abort();
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", painted);
    };
  }, [token, sequence, revision, slideId]);
};
