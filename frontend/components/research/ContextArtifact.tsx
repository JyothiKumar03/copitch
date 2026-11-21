"use client";

import Markdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Download, FileText, LoaderCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useContextArtifact } from "@/hooks/research/use-context-artifact";
import { graphPlaceholder } from "@/lib/context-graphs";
import { cn } from "@/lib/utils";
import type { TContextArtifactProps } from "@/types/research";
import { PitchChart } from "./PitchChart";

const components: Components = {
  h1: ({ children }) => <h3 className="mb-5 font-document text-[clamp(2rem,6vw,3.75rem)] leading-[.95] tracking-[-.05em]">{children}</h3>,
  h2: ({ children, id }) => <h4 id={id} className="mb-2 mt-6 text-lg font-semibold tracking-tight">{children}</h4>,
  h3: ({ children }) => <h5 className="mb-2 mt-4 font-semibold">{children}</h5>,
  p: ({ children }) => <p className="my-2 leading-relaxed">{children}</p>,
  ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>,
  a: ({ node, href, ...props }) => {
    const external = !!href && !href.startsWith("#");
    return <a {...props} href={href} target={external ? "_blank" : undefined} rel={external ? "noreferrer" : undefined}
      className={cn("font-medium text-evidence underline underline-offset-2", node?.properties.dataFootnoteRef !== undefined && "rounded-sm bg-evidence/10 px-1")} />;
  },
};

const documentUrl = (href: string) => /^(?:https?:\/\/|#)/i.test(href) ? href : undefined;

const ResearchDocument = (props: TContextArtifactProps) => {
  const { artifact, partial, download, retry } = useContextArtifact(props);
  const preview = artifact.data?.preview ?? partial;

  return <>
    <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 border-b border-border bg-card px-3 py-2.5 sm:px-6">
      <DialogTitle className="flex items-center gap-2 text-base"><FileText size={17} aria-hidden="true" className="text-evidence" /> Research brief</DialogTitle>
      <div className="flex items-center gap-1.5">
        <Button type="button" variant="outline" size="sm" aria-label="Download context.md" disabled={!artifact.data || download.isPending} onClick={() => download.mutate()}>
          <Download size={15} aria-hidden="true" />
          <span aria-hidden="true" className="sm:hidden">{download.isPending ? "Downloading…" : "Download"}</span>
          <span aria-hidden="true" className="hidden sm:inline">{download.isPending ? "Downloading…" : "Download context.md"}</span>
        </Button>
        <DialogClose asChild><Button type="button" variant="ghost" size="icon" className="size-9" aria-label="Close research brief"><X size={18} aria-hidden="true" /></Button></DialogClose>
      </div>
    </div>
    {(artifact.isPending || artifact.isError || download.error) && <div className="grid gap-2 px-4 py-3 text-sm sm:px-6">
      {artifact.isPending && <p role="status" className="flex items-center gap-2 text-muted-foreground"><LoaderCircle size={15} className="animate-spin" aria-hidden="true" /> Opening saved research…</p>}
      {artifact.isError && <div role="alert" className="flex flex-wrap items-center gap-3 text-destructive"><p>{artifact.error.message}</p><Button variant="outline" size="sm" onClick={retry}>Retry</Button></div>}
      {download.error && <p role="alert" className="text-destructive">{download.error.message}</p>}
    </div>}
    {preview && <article className="research-paper bg-document text-document-foreground" aria-label="Research findings">
      <div className="mx-auto max-w-[44rem] wrap-anywhere px-5 py-6 leading-relaxed sm:px-8 sm:py-10 [&_section[data-footnotes]]:mt-6 [&_section[data-footnotes]]:border-t [&_section[data-footnotes]]:border-border [&_section[data-footnotes]]:text-sm [&_section[data-footnotes]_li]:scroll-mt-20">
        <Markdown remarkPlugins={[remarkGfm]} skipHtml disallowedElements={["img"]} urlTransform={documentUrl} components={{ ...components,
          pre: ({ node, children }) => {
            const offset = node?.position?.start.offset;
            const code = node?.children[0];
            const chart = typeof offset === "number" && preview.graphs.get(offset);
            if (chart && code?.type === "element" && Array.isArray(code.properties.className) &&
              code.properties.className.includes("language-" + graphPlaceholder)) return <PitchChart chart={chart} />;
            return <pre className="my-3 whitespace-pre-wrap rounded bg-muted p-3 text-xs">{children}</pre>;
          },
        }}>{preview.markdown}</Markdown>
        {preview.rejectedGraphs > 0 && <p role="status" className="my-3 border-l-2 border-border px-3 text-sm text-muted-foreground">
          {preview.rejectedGraphs === 1 ? "One chart could not be displayed." : `${preview.rejectedGraphs} charts could not be displayed.`} The data is available in the Markdown download.
        </p>}
      </div>
    </article>}
  </>;
};

export const ContextArtifact = ({ label = "Open research brief", variant = "outline", ...props }: TContextArtifactProps & { label?: string; variant?: "ghost" | "outline" }) => (
  <Dialog>
    <DialogTrigger asChild><Button type="button" variant={variant} size="sm" className="justify-start px-2.5"><FileText size={15} aria-hidden="true" className="text-evidence" />{label}</Button></DialogTrigger>
    <DialogContent aria-describedby={undefined} showCloseButton={false} className="block max-w-4xl overflow-x-hidden p-0">
      <ResearchDocument {...props} />
    </DialogContent>
  </Dialog>
);
