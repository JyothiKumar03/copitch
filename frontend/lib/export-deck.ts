import { createElement } from "react";
import { PublicSlide, deckSlideView } from "@/components/deck/Slide";
import { stageStyle } from "./stage-style";
import type { TDeck } from "@/types/deck";

export const exportDeck = async (deck: TDeck) => {
  const { renderToStaticMarkup } = await import("react-dom/server.browser");
  const doc = document.implementation.createHTMLDocument(`${deck.title} · copitch`);
  doc.documentElement.lang = "en";
  const charset = doc.createElement("meta");
  charset.setAttribute("charset", "utf-8");
  doc.head.prepend(charset);
  const generator = doc.createElement("meta");
  generator.name = "generator";
  generator.content = "copitch";
  doc.head.append(generator);
  const viewport = doc.createElement("meta");
  viewport.name = "viewport";
  viewport.content = "width=device-width, initial-scale=1";
  doc.head.append(viewport);
  const style = doc.createElement("style");
  style.textContent = stageStyle + `
    *{box-sizing:border-box}body{margin:0;background:#f6edeb}h3,ul,footer{margin:0}
    .slide-shell{border-radius:0;min-height:100dvh;padding:clamp(20px,6vw,80px)}
    .slide-shell[data-density=dense]{padding:clamp(20px,3vw,48px)}
    nav{display:flex;gap:1em;font:500 16px/1.5 system-ui}a{color:inherit;text-underline-offset:.25em}
    @media print{.slide-shell{min-height:0;break-after:page}nav{display:none}}`;
  doc.head.append(style);

  const append = (parent: HTMLElement, tag: string, text: string) => {
    const node = doc.createElement(tag);
    node.textContent = text;
    parent.append(node);
    return node;
  };
  deck.slides.forEach((slide, index) => {
    const template = doc.createElement("template");
    template.innerHTML = renderToStaticMarkup(createElement(PublicSlide, { view: deckSlideView(deck, slide, index) }));
    const section = template.content.firstElementChild as HTMLElement;
    section.id = "slide-" + (index + 1);
    doc.body.append(section);
    const nav = append(section, "nav", "");
    for (const [offset, label] of [[-1, "Previous"], [1, "Next"]] as const) {
      const target = index + offset;
      if (!deck.slides[target]) continue;
      const link = doc.createElement("a");
      link.href = "#slide-" + (target + 1);
      link.textContent = label;
      nav.append(link);
    }
  });
  const blob = new Blob(["<!doctype html>\n", doc.documentElement.outerHTML], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `presentation-r${deck.revision}.html`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
