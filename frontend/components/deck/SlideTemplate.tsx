import type { TSlideTemplate } from "@/types/deck";

type TChartTemplate = Extract<TSlideTemplate, { points: unknown[] }>;
const number = new Intl.NumberFormat("en", { maximumSignificantDigits: 21 });
const colors = ["#5b4bdb", "#e0703a", "#1f8a8a", "#b54a7a", "#8a6d1f", "#3f7d3a", "#6a6f7a", "#9a5bd0"];

// Bars read from the room: thick marks drawn to one scale, the label beside each bar, the value at its end,
// and the largest value in the accent colour so the takeaway stands out.
const BarChart = ({ chart }: { chart: TChartTemplate }) => {
  const values = chart.points.map(point => point.value);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const range = max - min || 1;
  const zero = -min / range * 100;
  const top = Math.max(...values);
  return <div className="bars" role="list">
    {chart.points.map(({ label, value }, i) => <div className="bar-row" role="listitem" key={i} data-top={value === top || undefined}>
      <span className="bar-label">{label}</span>
      <span className="bar-track" aria-hidden="true">
        {min < 0 && <span className="bar-zero" style={{ left: `${zero}%` }} />}
        <span className="bar-mark" style={{ left: `${Math.min(zero, (value - min) / range * 100)}%`, width: `${Math.max(.6, Math.abs(value) / range * 100)}%` }} />
      </span>
      <span className="bar-value">{number.format(value)}</span>
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
  const labelled = new Set([0, marks.length - 1, values.indexOf(max), values.indexOf(min)]);
  return <svg viewBox="0 0 600 220" aria-hidden="true" className="line">
    <line x1="40" x2="560" y1="190" y2="190" className="line-axis" />
    <polyline points={marks.map(({ cx, cy }) => `${cx},${cy}`).join(" ")} className="line-path" />
    {marks.map(({ cx, cy, label, value }, i) => <g key={i}>
      <circle cx={cx} cy={cy} r={labelled.has(i) ? 6 : 4} className="line-dot" />
      {labelled.has(i) && <text x={cx} y={cy - 14} textAnchor="middle" className="line-value">{number.format(value)}</text>}
      <text x={cx} y={212} textAnchor="middle" className="line-label">{label}</text>
    </g>)}
  </svg>;
};

const DonutChart = ({ chart }: { chart: TChartTemplate }) => {
  const values = chart.points.map(point => Math.max(0, point.value));
  const total = values.reduce((sum, value) => sum + value, 0);
  if (!total) return null;
  return <div className="donut">
    <svg viewBox="0 0 42 42" aria-hidden="true">
      {values.map((value, i) => {
        const length = value / total * 100;
        const offset = values.slice(0, i).reduce((sum, part) => sum + part, 0) / total * 100;
        return <circle key={i} cx="21" cy="21" r="15.9155" fill="none" stroke={colors[i % colors.length]} strokeWidth="6"
          strokeDasharray={`${length} ${100 - length}`} strokeDashoffset={-offset} transform="rotate(-90 21 21)" />;
      })}
    </svg>
    <dl>{chart.points.map(({ label, value }, i) => <div key={i}>
      <dt><span aria-hidden="true" className="donut-dot" style={{ background: colors[i % colors.length] }} />{label}</dt>
      <dd>{number.format(value)}</dd>
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
