import Link from "next/link";
import { ResearchWorkspace } from "@/components/research/ResearchWorkspace";

export default function ResearchPage() {
  return (
    <main className="mx-auto min-h-screen max-w-3xl px-5 py-10 sm:py-16">
      <Link href="/" className="text-sm text-slate-400 hover:underline">← Equal AI</Link>
      <h1 className="mt-8 mb-2 text-4xl font-semibold tracking-tight">Private research brief</h1>
      <p className="mb-8 text-slate-400">Describe the talk, review the research scope, then build a cited memo.</p>
      <ResearchWorkspace />
    </main>
  );
}
