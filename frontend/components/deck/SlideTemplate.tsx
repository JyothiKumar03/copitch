import type { CSSProperties } from "react";
import type { TSlideTemplate } from "@/types/deck";

type TChartTemplate = Extract<TSlideTemplate, { points: unknown[] }>;
const number = new Intl.NumberFormat("en", { maximumSignificantDigits: 21 });
const colors = ["#4f8454", "#ca693c", "#429393", "#aa5067", "#9d842a", "#2e5b43", "#6a7770", "#a2916b"];

// Bars read from the room: thick marks drawn to one scale, the label beside each bar, the value at its end,
// and the largest value in the accent colour so the takeaway stands out.
const BarChart = ({ chart }: { chart: TChartTemplate }) => {
  const values = chart.points.map(point => point.value);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const range = max - min || 1;
  const zero = -min / range * 100;
  const top = Math.max(...values);
  const valueWidth = Math.max(...values.map(value => number.format(value).length)) + 1;
  return <div className="bars" role="list" data-negative={min < 0 || undefined} data-many={values.length > 5 || undefined}
    style={{ "--bar-label-space": `${valueWidth}ch` } as CSSProperties}>
    {chart.points.map(({ label, value }, i) => <div className="bar-row" role="listitem" key={i} data-top={value === top || undefined}>
      <span className="bar-label">{label}</span>
      <span className="bar-measure">
        <span className="bar-track">
          <span className="bar-mark" aria-hidden="true" style={{ left: `${Math.min(zero, (value - min) / range * 100)}%`, width: `${Math.abs(value) / range * 100}%` }} />
          {min < 0 && <span className="bar-zero" aria-hidden="true" style={{ left: `${zero}%` }} />}
          <span className="bar-value" data-negative={value < 0 || undefined} style={{ left: `${(value - min) / range * 100}%` }}>{number.format(value)}</span>
        </span>
      </span>
    </div>)}
  </div>;
};

const LineChart = ({ chart }: { chart: TChartTemplate }) => {
  const values = chart.points.map(point => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = (max - min) * .15 || Math.abs(max) * .1 || 1;
  const low = min - pad;
  const high = max + pad;
  const x = (i: number) => 40 + i * 520 / Math.max(1, values.length - 1);
  const y = (value: number) => 20 + (high - value) / (high - low) * 150;
  const marks = chart.points.map((point, i) => ({ ...point, cx: x(i), cy: y(point.value) }));
  const ends = new Set([0, marks.length - 1]);
  return <svg viewBox="0 0 600 220" aria-hidden="true" className="line">
    <line x1="40" x2="560" y1="190" y2="190" className="line-axis" />
    <polyline points={marks.map(({ cx, cy }) => `${cx},${cy}`).join(" ")} className="line-path" />
    {marks.map(({ cx, cy, label, value }, i) => <g key={i}>
      <circle cx={cx} cy={cy} r={ends.has(i) ? 6 : 4} className="line-dot" />
      {ends.has(i) && <>
        <text x={cx} y={cy - 14} textAnchor={i === 0 ? "start" : "end"} className="line-value">{number.format(value)}</text>
        <text x={cx} y={212} textAnchor={i === 0 ? "start" : "end"} className="line-label">{label}</text>
      </>}
    </g>)}
  </svg>;
};

const DonutChart = ({ chart }: { chart: TChartTemplate }) => {
  const total = chart.points.reduce((sum, point) => sum + point.value, 0);
  if (!Number.isFinite(total) || total <= 0 || chart.points.some(point => point.value < 0)) return null;
  const percentUnit = /^(?:%|percent|per cent|percentage)$/i.test(chart.unit);
  const segments = chart.points.map(({ label, value }, index) => {
    const share = value / total * 100;
    const offset = chart.points.slice(0, index).reduce((sum, point) => sum + point.value, 0) / total * 100;
    return { label, value, share, offset, swatch: colors[index % colors.length] };
  });
  return <div className="donut">
    <svg viewBox="0 0 42 42" aria-hidden="true">
      <circle cx="21" cy="21" r="16" fill="none" stroke="var(--slide-rule)" strokeWidth="6" />
      {segments.filter(segment => segment.share > 0).map(({ label, share, offset, swatch }, index) =>
        <circle key={label + index} cx="21" cy="21" r="16" pathLength="100" fill="none" stroke={swatch} strokeWidth="6"
          strokeDasharray={`${share} ${100 - share}`} strokeDashoffset={-offset} transform="rotate(-90 21 21)" />)}
    </svg>
    <dl>{segments.map(({ label, value, swatch }, index) => <div key={label + index}>
      <dt><span aria-hidden="true" className="donut-dot" style={{ background: swatch }} />{label}</dt>
      <dd>{number.format(value)}{percentUnit ? "%" : ""}</dd>
    </div>)}</dl>
  </div>;
};

const SlideChart = ({ chart, period }: { chart: TChartTemplate; period?: string }) => {
  if (!chart.points.length) return null;
  const caption = [chart.unit, period].filter(Boolean).join(" · ");
  const label = chart.type === "bar_chart" ? "Bar chart" : chart.type === "line_chart" ? "Line chart" : "Donut chart";
  return <figure className={`template-chart template-chart-${chart.type}`} aria-label={`${label}${caption ? ", " + caption : ""}: ` +
    chart.points.map(point => `${point.label} ${number.format(point.value)}`).join(", ")}>
    {caption && <figcaption>{caption}</figcaption>}
    {chart.type === "bar_chart" ? <BarChart chart={chart} /> : chart.type === "line_chart" ? <LineChart chart={chart} /> : <DonutChart chart={chart} />}
  </figure>;
};

export const SlideTemplate = ({ template, period }: { template: TSlideTemplate; period?: string }) => {
  switch (template.type) {
    case "metric_grid": return <dl className="template-metrics">
      {template.metrics.map(({ label, value }, i) => <div key={i}><dt>{label}</dt><dd>{value}</dd></div>)}
    </dl>;
    case "timeline": return <ol className="template-timeline">
      {template.entries.map(({ date, label }, i) => <li key={i}><strong>{date}</strong><span>{label}</span></li>)}
    </ol>;
    case "quote": return <blockquote className="template-quote"><p>“{template.quote}”</p>{template.attribution && <cite>{template.attribution}</cite>}</blockquote>;
    case "comparison": return <div className="template-comparison">
      {template.columns.map(({ label, points }, i) => <section key={i}><h4>{label}</h4><ul>{points.map((point, j) => <li key={j}>{point}</li>)}</ul></section>)}
    </div>;
    case "bar_chart": case "line_chart": case "donut_chart": return <SlideChart chart={template} period={period} />;
    default: return null;
  }
};
