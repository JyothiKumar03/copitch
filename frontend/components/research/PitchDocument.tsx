"use client";

import { useMemo } from "react";
import Markdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { graphPlaceholder } from "@/lib/context-graphs";
import type { TContextPreview } from "@/types/pitch-artifact";
import { PitchChart } from "./PitchChart";

const components: Components = {
  h1: ({ children }) => <h3 className="mb-4 break-words font-display text-3xl leading-tight tracking-tight sm:text-4xl">{children}</h3>,
  h2: ({ children, ...props }) => <h4 id={props.id} className="mt-6 mb-2 text-base font-semibold">{children}</h4>,
  h3: ({ children }) => <h5 className="mt-4 mb-2 font-semibold">{children}</h5>,
  p: ({ children }) => <p className="my-2 leading-relaxed">{children}</p>,
  ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>,
  a: ({ children, href, id, title }) => {
    const external = !!href && !href.startsWith("#");
    return <a href={href} id={id} title={title} target={external ? "_blank" : undefined} rel={external ? "noreferrer" : undefined}
      className="break-words text-primary underline underline-offset-2">{children}</a>;
  },
};

// Only locally-rendered chart fences and explicit source links are active in a private artifact.
const documentUrl = (href: string) => /^(?:https?:\/\/|#)/i.test(href) ? href : undefined;

export const PitchDocument = ({ preview }: { preview: TContextPreview }) => {
  const { graphs } = preview;
  const renderers = useMemo<Components>(() => ({ ...components, pre: ({ node, children }) => {
      const offset = node?.position?.start.offset;
      const code = node?.children[0];
      const chart = typeof offset === "number" && graphs.get(offset);
      if (chart && code?.type === "element" && Array.isArray(code.properties.className) &&
        code.properties.className.includes("language-" + graphPlaceholder)) return <PitchChart chart={chart} />;
      return <pre className="my-3 overflow-x-auto whitespace-pre-wrap rounded bg-muted p-3 text-xs">{children}</pre>;
  } }), [graphs]);
  return <div className="min-w-0 break-words text-[0.97rem] text-foreground [&_section[data-footnotes]]:mt-6 [&_section[data-footnotes]]:border-t [&_section[data-footnotes]]:border-border [&_section[data-footnotes]]:text-sm [&_section[data-footnotes]_li]:scroll-mt-32 [&_table]:max-w-full">
    <Markdown remarkPlugins={[remarkGfm]} components={renderers} disallowedElements={["img"]} skipHtml urlTransform={documentUrl}>{preview.markdown}</Markdown>
    {preview.rejectedGraphs > 0 && <p role="status" className="my-3 border-l-2 border-border px-3 text-sm text-muted-foreground">
      {preview.rejectedGraphs === 1 ? "One chart could not be displayed." : `${preview.rejectedGraphs} charts could not be displayed.`} Its raw data remains in Markdown.
    </p>}
  </div>;
};
