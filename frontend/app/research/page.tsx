import type { Metadata } from "next";
import { SiteHeader } from "@/components/site/SiteHeader";
import { ProjectStudio } from "@/components/projects/ProjectStudio";

export const metadata: Metadata = { title: "Pitch studio" };

const ResearchPage = async ({ searchParams }: { searchParams: Promise<{ project?: string }> }) => (
  <>
    <SiteHeader inStudio />
    <main className="mx-auto w-full max-w-7xl px-4 pb-10 pt-4 text-foreground sm:px-8 sm:pb-10 lg:px-12">
      <ProjectStudio projectId={(await searchParams).project} />
    </main>
  </>
);
export default ResearchPage;
