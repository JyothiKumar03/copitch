import type { Metadata } from "next";
import { SiteHeader } from "@/components/site/SiteHeader";
import { ProjectStudio } from "@/components/projects/ProjectStudio";

export const metadata: Metadata = { title: "Pitch studio" };

const ResearchPage = async ({ searchParams }: { searchParams: Promise<{ project?: string; view?: string }> }) => {
  const { project, view } = await searchParams;
  return <>
    <SiteHeader inStudio />
    <main className="mx-auto w-full max-w-[100rem] px-4 pb-8 pt-4 text-foreground sm:px-6 lg:px-8">
      <ProjectStudio projectId={project} walkthrough={view === "walkthrough"} />
    </main>
  </>;
};
export default ResearchPage;
