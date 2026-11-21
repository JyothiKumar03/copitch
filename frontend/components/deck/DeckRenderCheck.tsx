"use client";

import { useEffect, useRef, useState } from "react";
import { PublicSlide } from "./Slide";
import { stageStyle } from "@/lib/stage-style";
import type { TSlideView } from "@/types/deck";

type TRenderIssue = { slide_id: string; issue: "overflow" | "collision" | "unreadable_text"; viewport: string; note: string };
type TRenderWindow = Window & { setDeckRenderViews?: (views: TSlideView[]) => void };

const reviewStyle = `
  .deck-render-sheet {margin:0; padding:8px; width:1224px; background:#edf0f2; display:grid;
    gap:8px; grid-template-columns:repeat(3,400px);}
  .deck-render-cell {position:relative; width:400px; height:225px; overflow:hidden;}
  .deck-render-frame {width:1280px; height:720px; transform-origin:top left; transform:scale(.3125);}
  .deck-render-frame > .slide-shell {width:100%; height:100%; min-height:0; box-sizing:border-box;}
`;

const measureDeck = (sheet: HTMLElement): TRenderIssue[] =>
  Array.from(sheet.querySelectorAll<HTMLElement>("[data-render-slide]")).flatMap(frame => {
    const slide = frame.querySelector<HTMLElement>(".slide-shell");
    if (!slide) return [];
    const slideId = frame.dataset.renderSlide!;
    const viewport = "1280×720";
    const issues: TRenderIssue[] = [];
    const bounds = slide.getBoundingClientRect();
    const title = slide.querySelector("h3");
    const content = slide.querySelector(".slide-content");
    const footer = slide.querySelector("footer");
    const visible = Array.from(slide.querySelectorAll("h3,footer,li,dt,dd,figcaption,blockquote,.bar-label,.bar-value,.line-label,.line-value"));
    const clips = visible.some(item => {
      const rect = item.getBoundingClientRect();
      return rect.right > bounds.right + 1 || rect.bottom > bounds.bottom + 1 ||
        item instanceof HTMLElement && item.scrollWidth > item.clientWidth + 2;
    });
    if (clips || slide.scrollHeight > slide.clientHeight + 2 || slide.scrollWidth > slide.clientWidth + 2) {
      issues.push({ slide_id: slideId, issue: "overflow", viewport, note: "Content extends beyond the slide frame." });
    }
    if (title && content && title.getBoundingClientRect().bottom > content.getBoundingClientRect().top + 1 ||
        content && footer && content.getBoundingClientRect().bottom > footer.getBoundingClientRect().top + 1) {
      issues.push({ slide_id: slideId, issue: "collision", viewport, note: "Slide sections overlap." });
    }
    if (visible.filter(item => item !== footer).some(item => parseFloat(getComputedStyle(item).fontSize) < 14)) {
      issues.push({ slide_id: slideId, issue: "unreadable_text", viewport, note: "Body text is below the template legibility floor." });
    }
    return issues;
  });

export const DeckRenderCheck = () => {
  const sheet = useRef<HTMLDivElement>(null);
  const [views, setViews] = useState<TSlideView[]>([]);
  const [report, setReport] = useState<TRenderIssue[]>();

  useEffect(() => {
    const browser = window as TRenderWindow;
    browser.setDeckRenderViews = next => { setReport(undefined); setViews(next); };
    return () => { delete browser.setDeckRenderViews; };
  }, []);

  useEffect(() => {
    if (!views.length) return;
    let active = true;
    void document.fonts.ready.then(() => {
      requestAnimationFrame(() => {
        if (active && sheet.current) setReport(measureDeck(sheet.current));
      });
    });
    return () => { active = false; };
  }, [views]);

  return <>
    <style>{stageStyle + reviewStyle}</style>
    <div ref={sheet} className="deck-render-sheet" data-deck-render-report={report && JSON.stringify(report)}>
      {views.map(view => <div key={view.slide.slide_id} className="deck-render-cell">
        <div data-render-slide={view.slide.slide_id} className="deck-render-frame"><PublicSlide view={view} /></div>
      </div>)}
    </div>
  </>;
};
