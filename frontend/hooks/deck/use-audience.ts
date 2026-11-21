"use client";

import { useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchProjection } from "@/lib/audience";

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
