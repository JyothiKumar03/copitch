import Markdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { readPitchChart } from "@/lib/pitch-artifact";
import { PitchChart } from "./PitchChart";

const components: Components = {
  h1: ({ children }) => <h3 className="mb-4 break-words font-display text-3xl leading-tight tracking-tight sm:text-4xl">{children}</h3>,
  h2: ({ children, ...props }) => <h4 id={props.id} className="mt-6 mb-2 text-base font-semibold">{children}</h4>,
  h3: ({ children }) => <h5 className="mt-4 mb-2 font-semibold">{children}</h5>,
  p: ({ children }) => <p className="my-2 leading-relaxed">{children}</p>,
  ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>,
  a: ({ children, href, id, title }) => <a href={href} id={id} title={title} className="break-words text-primary underline underline-offset-2">{children}</a>,
  pre: ({ node, children }) => {
    const code = node?.children[0];
    if (code?.type === "element" && code.tagName === "code" &&
      Array.isArray(code.properties.className) && code.properties.className.includes("language-recharts")) {
      const source = code.children.map(child => child.type === "text" ? child.value : "").join("");
      const chart = readPitchChart(source);
      if (chart) return <PitchChart chart={chart} />;
      return <p className="my-3 border-l-2 border-border px-3 text-sm text-muted-foreground">This chart could not be displayed. Its data is available in the Markdown.</p>;
    }
    return <pre className="my-3 overflow-x-auto whitespace-pre-wrap rounded bg-muted p-3 text-xs">{children}</pre>;
  },
};

// Only locally-rendered chart fences and explicit source links are active in a private artifact.
const documentUrl = (href: string) => /^(?:https?:\/\/|#)/i.test(href) ? href : undefined;

export const PitchDocument = ({ markdown }: { markdown: string }) => (
  <div className="min-w-0 break-words text-[0.97rem] text-foreground [&_section[data-footnotes]]:mt-6 [&_section[data-footnotes]]:border-t [&_section[data-footnotes]]:border-border [&_section[data-footnotes]]:text-sm [&_table]:max-w-full">
    <Markdown remarkPlugins={[remarkGfm]} components={components} disallowedElements={["img"]} skipHtml urlTransform={documentUrl}>{markdown}</Markdown>
  </div>
);
