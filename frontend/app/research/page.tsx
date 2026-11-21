import type { Metadata } from "next";
import { SiteHeader } from "@/components/site/SiteHeader";
import { ProjectStudio } from "@/components/projects/ProjectStudio";

export const metadata: Metadata = { title: "Pitch studio" };

const ResearchPage = async ({ searchParams }: { searchParams: Promise<{ project?: string }> }) => (
  <>
    <SiteHeader inStudio />
    <main className="mx-auto w-full max-w-360 px-4 pb-10 pt-5 text-foreground sm:px-8 sm:pt-7 lg:px-10">
      <ProjectStudio projectId={(await searchParams).project} />
    </main>
  </>
);
export default ResearchPage;
