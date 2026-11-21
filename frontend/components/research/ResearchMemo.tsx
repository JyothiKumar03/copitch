import { Fragment } from "react";
import type { TMemoCitation, TResearchMemoProps } from "@/types/research";

function readable(text: string) {
  return text.replace(/\\([\\`*_{}\[\]<>#!|])/g, "$1");
}

function readCitation(line: string): TMemoCitation | undefined {
  const definition = /^\[\^([A-Z]\d+)\]: (.+)$/.exec(line);
  if (!definition) return;
  const [, id, content] = definition;
  const external = /^\[(.*)\]\(<(https?:\/\/[^<>\s]+)>\)(.*)$/.exec(content);
  if (external) {
    return { id, label: readable(external[1]), href: external[2], detail: readable(external[3]) };
  }
  return { id, label: readable(content) };
}

export function ResearchMemo({ markdown }: TResearchMemoProps) {
  const citations = new Map<string, TMemoCitation>();
  const lines: string[] = [];
  for (const line of markdown.split("\n")) {
    const citation = readCitation(line);
    if (citation) citations.set(citation.id, citation);
    else if (line.trim()) lines.push(line);
  }

  return (
    <article className="space-y-4 rounded-xl border border-input p-5 leading-7">
      {lines.map((line, i) => {
        if (line.startsWith("# ")) return <h3 key={i} className="text-2xl font-semibold">{readable(line.slice(2))}</h3>;
        if (line.startsWith("## ")) return <h4 key={i} className="pt-2 text-lg font-semibold">{readable(line.slice(3))}</h4>;
        return <p key={i}>{line.split(/(\[\^[A-Z]\d+\])/g).map((part, index) => {
          const citation = citations.get(part.slice(2, -1));
          if (!part.startsWith("[^") || !citation) return <Fragment key={index}>{readable(part)}</Fragment>;
          return <a key={index} className="mx-1 font-medium underline" href={citation.href ?? "#source-" + citation.id}
            target={citation.href ? "_blank" : undefined} rel={citation.href ? "noreferrer" : undefined}
            aria-label={citation.label}>[{citation.id}]</a>;
        })}</p>;
      })}
      {[...citations.values()].map(source => (
        <p key={source.id} id={"source-" + source.id} className="break-words text-sm">
          <strong>[{source.id}] </strong>
          {source.href ? <a className="underline" href={source.href} target="_blank" rel="noreferrer">{source.label}</a> : source.label}
          {source.detail}
        </p>
      ))}
    </article>
  );
}
