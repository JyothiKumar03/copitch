import type { Metadata } from "next";
import { AudienceStage } from "@/components/deck/AudienceStage";

export const metadata: Metadata = { title: "Audience presentation", referrer: "no-referrer" };
const AudiencePage = () => {
  return <AudienceStage />;
};

export default AudiencePage;
