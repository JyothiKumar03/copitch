import { useQuery } from "@tanstack/react-query";
import { fetchPitchMarkdown } from "@/lib/pitch-artifact";
import type { TPitchContentProps } from "@/types/pitch-content";

export const usePitchArtifact = ({ researchId, getSession }: TPitchContentProps) => useQuery({
  queryKey: ["pitch-md", researchId],
  queryFn: async ({ signal }) => fetchPitchMarkdown(await getSession(), researchId, signal),
  staleTime: Infinity,
});
