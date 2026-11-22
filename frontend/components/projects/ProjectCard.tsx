import { ArrowUpRight, CalendarDays } from "lucide-react";

const initials = (name: string) => {
  const words = name.trim().split(/\s+/u).filter(Boolean);
  return ((words[0]?.[0] ?? "") + (words[1]?.[0] ?? words[0]?.[1] ?? "")).toLocaleUpperCase() || "P";
};

// A stable, per-project silhouette so cards are distinguishable at a glance.
const bars = (name: string) => {
  let seed = [...name].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 7);
  return Array.from({ length: 5 }, () => {
    seed = (seed * 1103515245 + 12345) >>> 0;
    return 30 + (seed % 70);
  });
};

export const ProjectCard = ({ name, href, created }: { name: string; href: string; created: string }) => (
  <a href={href} aria-label={`${name}, created ${created}`}
    className="group flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card transition-[border-color,box-shadow,translate] duration-200 hover:border-input hover:shadow-lg focus-visible:outline-offset-2 motion-safe:hover:-translate-y-0.5 motion-reduce:transition-none">
    <span aria-hidden="true" className="relative block h-28 overflow-hidden border-b border-border bg-secondary">
      <span className="absolute -right-10 -top-16 size-44 rounded-full opacity-80 blur-2xl" style={{ background: "var(--hero-glow)" }} />
      <span className="absolute bottom-0 left-5 w-[58%] translate-y-3 rounded-t-md border border-border bg-document p-3 shadow-md transition-transform duration-300 motion-safe:group-hover:translate-y-1">
        <span className="block h-1.5 w-2/3 rounded-full bg-document-foreground/70" />
        <span className="mt-2 block h-1 w-full rounded-full bg-document-foreground/20" />
        <span className="mt-1 block h-1 w-4/5 rounded-full bg-document-foreground/20" />
        <span className="mt-3 flex h-6 items-end gap-1">
          {bars(name).map((height, index) => <span key={index} className="w-2 rounded-t-[2px] bg-document-foreground/45" style={{ height: `${height}%` }} />)}
        </span>
      </span>
      <span className="absolute right-4 top-4 grid size-10 place-items-center rounded-lg bg-primary text-sm font-bold tracking-tight text-primary-foreground">{initials(name)}</span>
    </span>
    <span className="flex flex-1 items-start justify-between gap-3 p-4">
      <span className="min-w-0">
        <span className="block wrap-anywhere text-base font-semibold leading-snug">{name}</span>
        <span className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground"><CalendarDays size={12} aria-hidden="true" />{created}</span>
      </span>
      <ArrowUpRight aria-hidden="true" size={17} className="mt-0.5 shrink-0 text-muted-foreground transition-transform group-hover:text-primary motion-safe:group-hover:-translate-y-0.5 motion-safe:group-hover:translate-x-0.5" />
    </span>
  </a>
);
