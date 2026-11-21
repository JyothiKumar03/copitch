import Link from "next/link";
import { ArrowLeft, ArrowUpRight, AudioLines } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "./ThemeToggle";

type TSiteHeaderProps = { inStudio?: boolean };

export const SiteHeader = ({ inStudio = false }: TSiteHeaderProps) => (
  <header className={cn("nav border-b border-border", inStudio ? "bg-background" : "absolute inset-x-0 top-0 z-10")}>
    <div className={cn("flex items-center justify-between gap-2 sm:gap-4", inStudio
      ? "mx-auto min-h-14 w-full max-w-[100rem] px-4 sm:px-6 lg:px-8"
      : "wrap site-wrap min-h-16 sm:min-h-17")}>
      <Link href="/" aria-label="copitch home" className="inline-flex shrink-0 items-center gap-2.5 rounded-sm">
        <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground"><AudioLines aria-hidden="true" size={19} strokeWidth={1.9} /></span>
        <span className="text-[1.4rem] font-bold leading-none tracking-[-.065em]">copitch</span>
      </Link>
      <nav aria-label="Main navigation" className="flex items-center gap-1.5 text-sm font-medium sm:gap-3">
        <ThemeToggle />
        {inStudio ? (
          <Button asChild variant="ghost" size="sm"><Link href="/"><ArrowLeft aria-hidden="true" size={15} /> Home</Link></Button>
        ) : (
          <>
            <Link href="/#workflow" className="hidden text-muted-foreground underline-offset-4 hover:text-foreground hover:underline sm:inline">How it works</Link>
            <Button asChild><Link href="/research">Open studio <ArrowUpRight aria-hidden="true" size={16} /></Link></Button>
          </>
        )}
      </nav>
    </div>
  </header>
);
