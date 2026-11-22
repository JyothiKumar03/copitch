// One stylesheet for the host preview, the live stage, the render check and the offline HTML export.
// Sizes are in container-width units so a slide looks the same at 1280×720 on a projector and in a small preview.
// The font stack needs no download: the studio font when present, otherwise Helvetica or Arial in the offline file.
export const stageStyle = `
.slide-shell {
  --slide-bg:#f9faf2; --slide-ink:#18221b; --slide-muted:#4b584e; --slide-rule:#dce0d3; --slide-accent:#336239;
  --slide-bar:#bbcbb8; --slide-source:#8a5a12;
  --slide-font:"Hanken Grotesk Variable","Helvetica Neue",Helvetica,Arial,sans-serif;
  container-type:inline-size; box-sizing:border-box; display:grid; grid-template-rows:auto auto minmax(0,1fr) auto;
  gap:2.2cqw; aspect-ratio:16 / 9; inline-size:100%; min-inline-size:0; padding:4cqw 5cqw 3.2cqw;
  border:1px solid var(--slide-rule); border-radius:10px; background:var(--slide-bg); color:var(--slide-ink);
  font-family:var(--slide-font); overflow:hidden; overflow-wrap:anywhere;
}
.slide-top { display:flex; justify-content:space-between; gap:1rem; color:var(--slide-muted); font:500 1.35cqw/1.3 var(--slide-font); letter-spacing:.02em; }
.slide-top span:first-child { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.slide-top span:last-child { flex:none; font-variant-numeric:tabular-nums; }
.slide-shell h3 { margin:0; max-width:24ch; font:650 4.6cqw/1.08 var(--slide-font); letter-spacing:-.025em; text-wrap:balance; }
.slide-content { display:grid; grid-template-columns:minmax(0,1fr); align-content:center; gap:3cqw; min-height:0; }
.slide-visual { display:grid; min-width:0; align-content:center; }
.slide-screenshot { width:100%; aspect-ratio:16/10; object-fit:cover; object-position:top; border-radius:.6cqw; box-shadow:0 0 0 1px rgb(0 0 0 / .12); }
.slide-points { display:grid; gap:1.6cqw; margin:0; padding:0; list-style:none; font:400 2.35cqw/1.35 var(--slide-font); }
.slide-points li { display:grid; grid-template-columns:auto minmax(0,1fr); column-gap:.7em; max-width:42ch; }
.slide-points li::before { content:""; width:.36em; height:.36em; margin-top:.5em; border-radius:2px; background:var(--slide-accent); }
.slide-shell[data-composition=mixed] .slide-content { grid-template-columns:minmax(0,.85fr) minmax(0,1.15fr); align-items:center; }
.slide-shell[data-composition=mixed] .slide-points { font-size:2cqw; }
.slide-shell[data-composition=title] { grid-template-rows:auto minmax(0,1fr) 0 auto; }
.slide-shell[data-composition=title] h3, .slide-shell[data-template=title_card] h3 { align-self:center; font-size:5.6cqw; max-width:20ch; }
.slide-shell[data-template=title_card][data-composition=points] { grid-template-rows:auto minmax(0,1fr) minmax(0,1fr) auto; }
.slide-shell[data-template=title_card][data-composition=points] h3 { align-self:end; }
.slide-shell[data-template=title_card] .slide-content { align-content:start; }
.slide-shell[data-template=title_card] .slide-points { color:var(--slide-muted); font-size:2.4cqw; }
.slide-shell[data-template=title_card] .slide-points li::before { display:none; }
.slide-shell[data-layout=takeaway] { --slide-bg:#1b2b1d; --slide-ink:#f4f5ed; --slide-muted:#b9c9b7; --slide-rule:#3b4c3c; --slide-accent:#d8f879; --slide-bar:#4b624c; --slide-source:#f0ce89; }
.slide-shell[data-density=dense] h3 { font-size:3.7cqw; max-width:32ch; }
.slide-shell[data-density=dense] .slide-points { font-size:1.9cqw; gap:1.1cqw; }
.slide-shell[data-composition=points][data-template=bullet_slide] .slide-content:has(.slide-points > :nth-child(3)) { align-content:stretch; }
.slide-shell[data-composition=points][data-template=bullet_slide] .slide-points:has(> :nth-child(3)) { align-content:space-between; gap:.7cqw; padding-block:1cqw .45cqw; font-size:2.65cqw; }
.slide-shell[data-composition=points][data-template=bullet_slide][data-density=dense] .slide-points:has(> :nth-child(3)) { font-size:2.2cqw; }
.slide-shell[data-composition=points][data-template=bullet_slide] .slide-points:has(> :nth-child(3)) li { max-width:56ch; }
.slide-shell footer { grid-row:4; color:var(--slide-source); font:650 1.45cqw/1.25 var(--slide-font); }
.template-chart { display:grid; gap:1.4cqw; min-inline-size:0; margin:0; }
.template-chart figcaption { color:var(--slide-muted); font:500 1.6cqw/1.3 var(--slide-font); }
.bars { --bar-height:3.3cqw; --bar-type:2.2cqw; display:grid; grid-template-columns:fit-content(34%) minmax(0,1fr); gap:1.2cqw 1.5cqw; }
.bars[data-many=true] { --bar-height:1.58cqw; --bar-type:1.44cqw; row-gap:.42cqw; }
.bar-row { display:grid; grid-column:1/-1; grid-template-columns:subgrid; align-items:center; font:550 var(--bar-type)/1.15 var(--slide-font); }
.bar-label { align-self:center; color:var(--slide-muted); }
.bar-measure { min-inline-size:0; padding-inline-end:var(--bar-label-space); }
.bars[data-negative=true] .bar-measure { padding-inline-start:var(--bar-label-space); }
.bar-track { position:relative; display:block; height:var(--bar-height); }
.bar-mark { position:absolute; top:0; height:100%; border-radius:.26cqw; background:var(--slide-bar); }
.bar-row[data-top] .bar-mark { background:var(--slide-accent); }
.bar-row[data-top] .bar-label, .bar-row[data-top] .bar-value { color:var(--slide-ink); font-weight:700; }
.bar-zero { position:absolute; top:-.18cqw; bottom:-.18cqw; width:max(1px,.12cqw); background:var(--slide-muted); }
.bar-value { position:absolute; top:50%; translate:0 -50%; padding-inline-start:.45em; white-space:nowrap; font-variant-numeric:tabular-nums; }
.bar-value[data-negative=true] { translate:-100% -50%; padding-inline:0 .45em; }
.line { width:100%; height:auto; max-height:30cqw; overflow:visible; font-family:var(--slide-font); }
.line-axis { stroke:var(--slide-rule); stroke-width:2; }
.line-path { fill:none; stroke:var(--slide-accent); stroke-width:4; stroke-linejoin:round; stroke-linecap:round; }
.line-dot { fill:var(--slide-accent); stroke:var(--slide-bg); stroke-width:2; }
.line-value { fill:var(--slide-ink); font-size:17px; font-weight:700; }
.line-label { fill:var(--slide-muted); font-size:16px; }
.donut { display:grid; grid-template-columns:minmax(0,.8fr) minmax(0,1fr); align-items:center; gap:3cqw; }
.donut svg { width:100%; max-width:24cqw; justify-self:center; }
.donut dl { display:grid; gap:1.2cqw; margin:0; font:500 1.9cqw/1.25 var(--slide-font); }
.donut dl div { display:flex; justify-content:space-between; gap:1.5cqw; border-bottom:1px solid var(--slide-rule); padding-bottom:.6cqw; }
.donut dd { margin:0; font-variant-numeric:tabular-nums; font-weight:700; }
.donut-dot { display:inline-block; width:.7em; height:.7em; margin-right:.5em; border-radius:2px; }
.template-metrics { display:grid; grid-template-columns:repeat(auto-fit,minmax(0,1fr)); gap:3cqw; margin:0; }
.template-metrics div { display:flex; flex-direction:column-reverse; gap:.8cqw; border-top:3px solid var(--slide-accent); padding-top:1.4cqw; }
.template-metrics dd { margin:0; font:700 6.4cqw/1 var(--slide-font); letter-spacing:-.035em; font-variant-numeric:tabular-nums; }
.slide-shell[data-composition=visual] .template-metrics div:only-child dd { font-size:9.2cqw; }
.template-metrics dt { color:var(--slide-muted); font:500 1.9cqw/1.3 var(--slide-font); }
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
