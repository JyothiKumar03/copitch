import type { TSlideTemplate } from "@/types/deck";

type TChartTemplate = Extract<TSlideTemplate, { points: unknown[] }>;
const number = new Intl.NumberFormat("en", { maximumFractionDigits: 6 });
const colors = ["#77354f", "#ba7554", "#4a696c", "#624a88", "#8a632b", "#a65068", "#406c50", "#7c623e"];

const SlideChart = ({ chart }: { chart: TChartTemplate }) => {
  if (!chart.points.length) return null;
  const values = chart.points.map(point => point.value);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const range = max - min || 1;
  const total = values.reduce((sum, value) => sum + Math.max(0, value), 0);
  const linePoints = chart.points.map((point, i) => ({ x: 10 + i * 360 / Math.max(1, values.length - 1), y: 86 - (point.value - min) / range * 72 }));
  return <figure className={`template-chart template-chart-${chart.type}`} aria-label={chart.unit || "Chart"}>
    {chart.type === "line_chart" && <svg viewBox="0 0 380 100" aria-hidden="true">
      <polyline points={linePoints.map(({ x, y }) => `${x},${y}`).join(" ")} fill="none" stroke="currentColor" strokeWidth="3" />
      {linePoints.map(({ x, y }, i) => <circle key={i} cx={x} cy={y} r="4" fill="currentColor" />)}
    </svg>}
    {chart.type === "donut_chart" && total > 0 && <svg viewBox="0 0 42 42" aria-hidden="true">
      {values.map((value, i) => {
        const length = Math.max(0, value) / total * 100;
        const offset = values.slice(0, i).reduce((sum, part) => sum + Math.max(0, part), 0) / total * 100;
        return <circle key={i} cx="21" cy="21" r="15.9155" fill="none" stroke={colors[i % colors.length]} strokeWidth="5"
          strokeDasharray={`${length} ${100 - length}`} strokeDashoffset={-offset} transform="rotate(-90 21 21)" />;
      })}
    </svg>}
    <dl className="template-chart-data">
      {chart.points.map(({ label, value }, i) => <div key={i}>
        <dt>{chart.type === "donut_chart" && <span aria-hidden="true" className="template-chart-dot" style={{ background: colors[i % colors.length] }} />}{label}</dt>
        {chart.type === "bar_chart" && <meter aria-label={label} min={min} max={max === min ? min + 1 : max} value={value} />}
        <dd>{number.format(value)}{chart.unit && " " + chart.unit}</dd>
      </div>)}
    </dl>
  </figure>;
};

export const SlideTemplate = ({ template }: { template: TSlideTemplate }) => {
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
    case "bar_chart": case "line_chart": case "donut_chart": return <SlideChart chart={template} />;
    default: return null;
  }
};
