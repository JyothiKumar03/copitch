// One stylesheet for the host preview, the live stage, the render check and the offline HTML export.
// Sizes are in container-width units so a slide looks the same at 1280×720 on a projector and in a small preview.
// The font stack needs no download: the studio font when present, otherwise Helvetica or Arial in the offline file.
export const stageStyle = `
.slide-shell {
  --slide-bg:#ffffff; --slide-ink:#15161a; --slide-muted:#5b5e66; --slide-rule:#e4e4e0; --slide-accent:#4f46e5;
  --slide-bar:#c9cbd3; --slide-source:#8a5a12;
  --slide-font:"Hanken Grotesk Variable","Helvetica Neue",Helvetica,Arial,sans-serif;
  container-type:inline-size; box-sizing:border-box; display:grid; grid-template-rows:auto auto minmax(0,1fr) auto;
  gap:2.2cqw; aspect-ratio:16 / 9; inline-size:100%; min-inline-size:0; padding:4cqw 5cqw 3.2cqw;
  border:1px solid var(--slide-rule); border-radius:10px; background:var(--slide-bg); color:var(--slide-ink);
  font-family:var(--slide-font); overflow:hidden; overflow-wrap:anywhere;
}
.slide-top { display:flex; justify-content:space-between; gap:1rem; color:var(--slide-muted); font:500 1.35cqw/1.3 var(--slide-font); letter-spacing:.02em; }
.slide-top span:last-child { flex:none; font-variant-numeric:tabular-nums; }
.slide-shell h3 { margin:0; max-width:24ch; font:650 4.6cqw/1.08 var(--slide-font); letter-spacing:-.025em; text-wrap:balance; }
.slide-content { display:grid; grid-template-columns:minmax(0,1fr); align-content:center; gap:3cqw; min-height:0; }
.slide-visual { display:grid; min-width:0; align-content:center; }
.slide-points { display:grid; gap:1.6cqw; margin:0; padding:0; list-style:none; font:400 2.35cqw/1.35 var(--slide-font); }
.slide-points li { display:grid; grid-template-columns:auto minmax(0,1fr); column-gap:.7em; max-width:42ch; }
.slide-points li::before { content:""; width:.36em; height:.36em; margin-top:.5em; border-radius:2px; background:var(--slide-accent); }
.slide-shell[data-composition=mixed] .slide-content { grid-template-columns:minmax(0,.85fr) minmax(0,1.15fr); align-items:center; }
.slide-shell[data-composition=mixed] .slide-points { font-size:2cqw; }
.slide-shell[data-composition=title] h3, .slide-shell[data-template=title_card] h3 { align-self:end; font-size:5.6cqw; max-width:20ch; }
.slide-shell[data-template=title_card] .slide-content { align-content:start; }
.slide-shell[data-template=title_card] .slide-points { color:var(--slide-muted); font-size:2.4cqw; }
.slide-shell[data-template=title_card] .slide-points li::before { display:none; }
.slide-shell[data-layout=takeaway] { --slide-bg:#15161a; --slide-ink:#f4f4f2; --slide-muted:#a4a7b0; --slide-rule:#2c2f36; --slide-accent:#8b85ff; --slide-bar:#3a3d46; --slide-source:#f5b544; }
.slide-shell[data-density=dense] h3 { font-size:3.7cqw; max-width:32ch; }
.slide-shell[data-density=dense] .slide-points { font-size:1.9cqw; gap:1.1cqw; }
.slide-shell footer { color:var(--slide-source); font:500 1.3cqw/1.3 var(--slide-font); }
.template-chart { display:grid; gap:1.4cqw; min-inline-size:0; margin:0; }
.template-chart figcaption { color:var(--slide-muted); font:500 1.6cqw/1.3 var(--slide-font); }
.bars { display:grid; gap:1.3cqw; }
.bar-row { display:grid; grid-template-columns:minmax(6ch,auto) minmax(0,1fr) auto; align-items:center; gap:1.4cqw; font:500 1.9cqw/1.2 var(--slide-font); }
.bar-label { color:var(--slide-muted); }
.bar-track { position:relative; display:block; height:3.2cqw; }
.bar-mark { position:absolute; top:0; height:100%; border-radius:0 .4cqw .4cqw 0; background:var(--slide-bar); }
.bar-row[data-top] .bar-mark { background:var(--slide-accent); }
.bar-row[data-top] .bar-label, .bar-row[data-top] .bar-value { color:var(--slide-ink); font-weight:700; }
.bar-zero { position:absolute; top:-.4cqw; bottom:-.4cqw; width:2px; background:var(--slide-muted); }
.bar-value { font-variant-numeric:tabular-nums; text-align:end; }
.line { width:100%; height:auto; max-height:34cqw; overflow:visible; font-family:var(--slide-font); }
.line-axis { stroke:var(--slide-rule); stroke-width:2; }
.line-path { fill:none; stroke:var(--slide-accent); stroke-width:4; stroke-linejoin:round; stroke-linecap:round; }
.line-dot { fill:var(--slide-accent); stroke:var(--slide-bg); stroke-width:2; }
.line-value { fill:var(--slide-ink); font-size:17px; font-weight:700; }
.line-label { fill:var(--slide-muted); font-size:14px; }
.donut { display:grid; grid-template-columns:minmax(0,.8fr) minmax(0,1fr); align-items:center; gap:3cqw; }
.donut svg { width:100%; max-width:24cqw; justify-self:center; }
.donut dl { display:grid; gap:1.2cqw; margin:0; font:500 1.9cqw/1.25 var(--slide-font); }
.donut dl div { display:flex; justify-content:space-between; gap:1.5cqw; border-bottom:1px solid var(--slide-rule); padding-bottom:.6cqw; }
.donut dd { margin:0; font-variant-numeric:tabular-nums; font-weight:700; }
.donut-dot { display:inline-block; width:.7em; height:.7em; margin-right:.5em; border-radius:2px; }
.template-metrics { display:grid; grid-template-columns:repeat(auto-fit,minmax(0,1fr)); gap:3cqw; margin:0; }
.template-metrics div { display:flex; flex-direction:column-reverse; gap:.8cqw; border-top:3px solid var(--slide-accent); padding-top:1.4cqw; }
.template-metrics dd { margin:0; font:700 6.2cqw/1 var(--slide-font); letter-spacing:-.03em; font-variant-numeric:tabular-nums; }
.template-metrics dt { color:var(--slide-muted); font:500 1.8cqw/1.3 var(--slide-font); }
.template-timeline { display:grid; grid-auto-flow:column; grid-auto-columns:minmax(0,1fr); gap:2cqw; margin:0; padding:0; list-style:none; }
.template-timeline li { display:grid; align-content:start; gap:.8cqw; border-top:3px solid var(--slide-accent); padding-top:1.3cqw; font:400 1.8cqw/1.3 var(--slide-font); }
.template-timeline strong { font:700 2.6cqw/1.1 var(--slide-font); }
.template-comparison { display:grid; grid-template-columns:repeat(auto-fit,minmax(0,1fr)); gap:3cqw; }
.template-comparison section { border-top:3px solid var(--slide-accent); padding-top:1.4cqw; }
.template-comparison h4 { margin:0 0 1cqw; font:700 2.4cqw/1.2 var(--slide-font); }
.template-comparison ul { display:grid; gap:.8cqw; margin:0; padding-inline-start:1.1em; font:400 1.9cqw/1.35 var(--slide-font); }
.template-quote { margin:0; border-left:.5cqw solid var(--slide-accent); padding-left:2.4cqw; }
.template-quote p { margin:0 0 1.2cqw; font:500 3.4cqw/1.25 var(--slide-font); }
.template-quote cite { color:var(--slide-muted); font:500 1.8cqw/1.3 var(--slide-font); font-style:normal; }
.conversion-chart { display:grid; margin:0; gap:1.2cqw; font:500 1.9cqw/1.3 var(--slide-font); }
.conversion-chart figcaption { color:var(--slide-muted); }
.conversion-row { display:grid; grid-template-columns:minmax(0,1fr) minmax(2rem,1fr) auto; align-items:center; gap:1.2cqw; }
.conversion-row meter { width:100%; height:2.6cqw; accent-color:var(--slide-accent); }
.conversion-row strong { grid-column:3; font-variant-numeric:tabular-nums; }
`;

export const slideDensity = (title: string, highlights: string[], chartRows = 0) => {
  const characters = title.length + highlights.join("").length;
  return characters > 360 || title.length > 80 || chartRows >= 8 ? "dense" : "regular";
};
