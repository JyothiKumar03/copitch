import Link from "next/link";
import { ArrowLeft, ArrowUpRight, AudioLines } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

type TSiteHeaderProps = { inStudio?: boolean };

export const SiteHeader = ({ inStudio = false }: TSiteHeaderProps) => (
  <header className="border-b border-border/75">
    <div className="mx-auto flex min-h-18 w-full max-w-360 items-center justify-between gap-5 px-5 sm:px-9 lg:px-[5.5%]">
      <Link href="/" aria-label="copitch home" className="inline-flex shrink-0 items-center gap-2.5">
        <span className="grid size-8 place-items-center rounded-full bg-primary text-primary-foreground"><AudioLines aria-hidden="true" size={18} strokeWidth={1.8} /></span>
        <span className="pt-1 font-display text-[1.8rem] leading-none tracking-[-0.065em]">copitch</span>
      </Link>
      <nav aria-label="Main navigation" className="flex items-center gap-7 text-sm font-medium">
        <Link href="/#workflow" className="hidden underline-offset-4 hover:underline sm:inline">How it works</Link>
        <Link href="/#sample" className="hidden underline-offset-4 hover:underline sm:inline">Sample pitch</Link>
        {inStudio
          ? <Link href="/" className={buttonVariants({ variant: "outline", size: "sm" })}><ArrowLeft aria-hidden="true" size={15} /> Home</Link>
          : <Link href="/research" className={buttonVariants({ variant: "outline", size: "sm" })}>Open studio <ArrowUpRight aria-hidden="true" size={16} /></Link>}
      </nav>
    </div>
  </header>
);
