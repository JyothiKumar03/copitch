export const stageStyle = `
.slide-shell { container-type:inline-size; display:flex; flex-direction:column; gap:clamp(12px,2.5vw,22px); padding:clamp(16px,4vw,42px); min-height:clamp(300px,38vw,490px); border:1px solid #cdbbc1; border-radius:2px; background:#fff6f0; color:#30212c; overflow-wrap:anywhere; }
.slide-top { display:flex; align-items:baseline; justify-content:space-between; gap:24px; padding-bottom:12px; border-bottom:1px solid currentColor; font:500 clamp(11px,2.1cqw,15px)/1.4 ui-sans-serif,system-ui; }
.slide-top span:last-child { flex:none; font-variant-numeric:tabular-nums; }
.slide-shell h3 { font:normal clamp(26px,7.3cqw,72px)/1.08 var(--font-display, Georgia),serif; letter-spacing:-.035em; max-width:26ch; }
.slide-shell ul { display:grid; gap:8px; padding:0; list-style:none; font:400 clamp(15px,3.3cqw,28px)/1.42 ui-sans-serif,system-ui; }
.slide-shell li { border-top:1px solid #92768180; padding-top:7px; }
.conversion-chart { display:grid; margin:0; gap:.4em; font:500 clamp(12px,2cqw,20px)/1.3 system-ui; }
.conversion-chart figcaption { font-weight:650; }
.conversion-row { display:grid; grid-template-columns:minmax(4em,1fr) 2fr auto; align-items:center; gap:.6em; }
.conversion-row meter { width:100%; accent-color:#77354f; }
.conversion-row strong { grid-column:3; font-variant-numeric:tabular-nums; }
.slide-shell footer { margin-top:auto; padding-top:12px; font:500 clamp(11px,1.9cqw,17px)/1.4 ui-sans-serif,system-ui; }
.slide-shell[data-layout=evidence] { background:#f1d8cf; }
.slide-shell[data-layout=evidence] li { padding-left:14px; border-left:3px solid #77354f; border-top:0; }
.slide-shell[data-layout=takeaway] { color:#fff8f3; background:#4c293c; }
.slide-shell[data-layout=takeaway] li { border-color:#e8b9ad88; }
.slide-shell[data-layout=takeaway] meter { accent-color:#ffc3aa; }
.slide-shell[data-density=dense] { gap:clamp(6px,1.1vw,16px); }
.slide-shell[data-density=dense] h3 { font-size:clamp(24px,3cqw,42px); max-width:100%; }
.slide-shell[data-density=dense] ul { gap:6px; font-size:clamp(15px,1.55cqw,22px); line-height:1.32; }
.slide-shell[data-density=dense] li { padding-top:4px; }
.slide-shell[data-density=dense] footer { padding-top:4px; }
.audience-slide { min-height:calc(100dvh - 2rem); }
.template-metrics,.template-comparison { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(125px,100%),1fr)); gap:clamp(10px,2cqw,22px); margin:0; }
.template-metrics div,.template-comparison section { border-top:1px solid currentColor; padding:10px 0; }
.template-metrics div { display:flex; flex-direction:column-reverse; gap:6px; }
.template-metrics dd { margin:0; font:500 clamp(22px,5cqw,46px)/1.1 var(--font-display,Georgia),serif; }
.template-metrics dt,.template-timeline,.template-quote cite,.template-chart-data,.template-comparison ul { font:500 clamp(14px,2.55cqw,20px)/1.4 system-ui; }
.template-timeline { display:grid; gap:8px; margin:0; padding:0; list-style:none; }
.template-timeline li { display:grid; grid-template-columns:minmax(5ch,auto) 1fr; gap:12px; }
.template-comparison h4 { margin:0 0 4px; font-size:clamp(15px,3cqw,22px); }
.template-comparison ul { gap:4px; }
.template-quote { margin:0; border-left:3px solid currentColor; padding-left:16px; }
.template-quote p { margin:0 0 8px; font:400 clamp(22px,4cqw,40px)/1.2 var(--font-display,Georgia),serif; }
.template-chart { display:grid; gap:12px; margin:0; }
.template-chart svg { width:100%; max-height:140px; }
.template-chart-donut_chart { grid-template-columns:minmax(84px,130px) minmax(0,1fr); align-items:center; }
.template-chart-data { display:grid; gap:5px; margin:0; }
.template-chart-data div { display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:center; gap:8px; }
.template-chart-bar_chart .template-chart-data div { grid-template-columns:minmax(0,1fr) minmax(20px,1fr) auto; }
.template-chart-data meter { width:100%; accent-color:#77354f; }
.template-chart-data dd { margin:0; font-variant-numeric:tabular-nums; text-align:end; }
.template-chart-dot { display:inline-block; width:.6em; height:.6em; margin-right:.4em; border-radius:50%; }
`;

export const slideDensity = (title: string, highlights: string[]) => {
  const characters = title.length + highlights.join("").length;
  return characters > 430 || title.length > 100 ? "dense" : "regular";
};
