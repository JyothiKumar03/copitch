"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { fetchProjection, openProjection, publishProjection } from "@/lib/audience";
import type { TAudienceProps, TPublisher, TRelease } from "@/types/audience";

export const useAudience = ({ getSession, deck, slideId, live }: TAudienceProps) => {
  const [publisher, setPublisher] = useState<TPublisher | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(Promise.resolve());
  const opening = useMutation({
    mutationFn: async ({ popup, release }: { popup: Window; release: TRelease }) => {
      try {
        const session = await getSession();
        await pending.current;
        const opened = await openProjection(session, release);
        if (popup.closed) throw new Error("Audience window closed before opening.");
        popup.location.replace("/audience#" + opened.token);
        setPublisher({ sequence: opened.sequence, release, session });
      } catch (error) {
        popup.close();
        throw error;
      }
    },
    onError: err => setError(err.message),
  });
  const deckId = deck?.deck_id;
  const revision = deck?.revision;
  useEffect(() => {
    if (!live || !publisher || !deckId || !revision || !slideId || publisher.release.deck_id !== deckId) return;
    let active = true;
    const release = { deck_id: deckId, revision, slide_id: slideId };
    pending.current = pending.current.then(async () => {
      if (!active || (publisher.release.revision === revision && publisher.release.slide_id === slideId)) return;
      const result = await publishProjection(publisher.session, release, publisher.sequence);
      publisher.sequence = result.sequence;
      publisher.release = release;
      if (active) setError(null);
    }).catch(err => { if (active) setError(err instanceof Error ? err.message : "Could not update audience view."); });
    return () => { active = false; };
  }, [publisher, live, deckId, revision, slideId]);

  const openAudience = () => {
    if (!live || !deckId || !revision || !slideId || opening.isPending) return;
    const popup = window.open("about:blank", "_blank");
    if (!popup) { setError("Allow pop-ups for this site to open the audience view."); return; }
    popup.opener = null;
    setError(null);
    opening.mutate({ popup, release: { deck_id: deckId, revision, slide_id: slideId } });
  };
  return { openAudience, opening: opening.isPending, error };
};

const observeHash = (update: () => void) => {
  window.addEventListener("hashchange", update);
  return () => window.removeEventListener("hashchange", update);
};

export const useAudienceView = () => {
  const token = useSyncExternalStore(observeHash, () => window.location.hash.slice(1), () => "");
  const view = useQuery({
    queryKey: ["audience", token], enabled: !!token, queryFn: ({ signal }) => fetchProjection(token, signal),
    retry: false, refetchInterval: 750, refetchIntervalInBackground: true,
  });
  return { token, view };
};
