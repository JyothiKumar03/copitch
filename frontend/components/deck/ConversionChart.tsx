import type { TConversionChart } from "@/types/deck";

export const ConversionChart = ({ chart }: { chart: TConversionChart }) => (
  <figure className="conversion-chart">
    <figcaption>Conversion rate{chart.period && " · " + chart.period}</figcaption>
    {chart.rows.map(row => <div className="conversion-row" key={row.evidence_id}>
      <span>{row.label}</span>
      <meter aria-label={row.label + " conversion rate"} min={0} max={1} value={row.denominator ? row.numerator / row.denominator : 0} hidden={!row.denominator} />
      <strong>{row.denominator ? (row.numerator / row.denominator).toLocaleString("en", { style: "percent", maximumFractionDigits: 2 }) : "Unavailable"} ({row.numerator}/{row.denominator})</strong>
    </div>)}
  </figure>
);
