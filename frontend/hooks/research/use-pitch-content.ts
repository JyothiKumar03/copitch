import { useQuery } from "@tanstack/react-query";
import { fetchPitchContent } from "@/lib/pitch-content";
import type { TPitchContentProps } from "@/types/pitch-content";

export const usePitchContent = ({ researchId, getSession }: TPitchContentProps) => useQuery({
  queryKey: ["research-pitch", researchId],
  queryFn: async ({ signal }) => fetchPitchContent(await getSession(), researchId, signal),
  staleTime: Infinity,
});
