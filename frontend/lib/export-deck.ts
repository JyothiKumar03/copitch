import { slideSource } from "./slide-source";
import { stageStyle, slideDensity } from "./stage-style";
import type { TDeck } from "@/types/deck";

export const exportDeck = (deck: TDeck) => {
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
    const section = doc.createElement("section");
    section.id = "slide-" + (index + 1);
    section.className = "slide-shell";
    section.dataset.layout = slide.layout;
    section.dataset.density = slideDensity(slide.title, slide.highlights);
    doc.body.append(section);
    const header = append(section, "div", "");
    header.className = "slide-top";
    append(header, "span", deck.title);
    append(header, "span", `${index + 1} / ${deck.slides.length}`);
    append(section, "h3", slide.title);
    const list = append(section, "ul", "");
    slide.highlights.forEach(highlight => append(list, "li", highlight));
    if (slide.chart) {
      const figure = append(section, "figure", "");
      figure.className = "conversion-chart";
      append(figure, "figcaption", "Conversion rate" + (slide.chart.period ? " · " + slide.chart.period : ""));
      for (const row of slide.chart.rows) {
        const line = append(figure, "div", "");
        line.className = "conversion-row";
        append(line, "span", row.label);
        const meter = doc.createElement("meter");
        meter.setAttribute("aria-label", row.label + " conversion rate");
        meter.value = row.denominator ? row.numerator / row.denominator : 0;
        meter.hidden = !row.denominator;
        line.append(meter);
        const rate = row.denominator ? meter.value.toLocaleString("en", { style: "percent", maximumFractionDigits: 2 }) : "Unavailable";
        append(line, "strong", `${rate} (${row.numerator}/${row.denominator})`);
      }
    }
    if (slide.evidence_ids.length) {
      const footer = append(section, "footer", "Sources · ");
      slide.evidence_ids.forEach((id, i) => {
        if (i) footer.append(", ");
        const source = slideSource(deck, id);
        if (source.href) {
          const link = doc.createElement("a");
          link.href = source.href;
          link.rel = "noreferrer";
          link.target = "_blank";
          link.textContent = source.label;
          footer.append(link);
        } else footer.append(source.label);
      });
    }
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
