"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { downloadContextMarkdown, streamContextMarkdown } from "@/lib/context-artifact";
import { createContextGraphDecoder } from "@/lib/context-graphs";
import type { TContextArtifact, TContextPreview } from "@/types/pitch-artifact";
import type { TContextArtifactProps } from "@/types/research";

export const useContextArtifact = ({ project, researchId, getSession }: TContextArtifactProps) => {
  const [partial, setPartial] = useState<TContextPreview | null>(null);
  const artifact = useQuery({
    queryKey: ["context-md", project, researchId], staleTime: Infinity, retry: false,
    queryFn: async ({ signal }): Promise<TContextArtifact> => {
      const session = await getSession();
      const decoder = createContextGraphDecoder();
      let frame: number | null = null;
      try {
        const markdown = await streamContextMarkdown(session, researchId, signal, chunk => {
          decoder.push(chunk);
          if (frame !== null) return;
          frame = requestAnimationFrame(() => {
            frame = null;
            if (!signal.aborted) setPartial(decoder.preview());
          });
        });
        return { markdown, preview: decoder.preview(true) };
      } finally { if (frame !== null) cancelAnimationFrame(frame); }
    },
  });
  const download = useMutation({ mutationFn: async () => downloadContextMarkdown(await getSession(), researchId) });
  return { artifact, partial, download, retry: () => { setPartial(null); void artifact.refetch(); } };
};
