"use client";

import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { TResearchGraph } from "../../../shared/research-graphs";

const shortLabel = (label: string) => label.length > 15 ? label.slice(0, 14) + "…" : label;
const axisStyle = { fill: "var(--ink-muted)", fontSize: 12 };
const formatNumber = new Intl.NumberFormat("en", { maximumSignificantDigits: 21 });
const formatValue = (value: number, unit: string) => {
  const text = value && Math.abs(value) < 1e-6 ? String(value) : formatNumber.format(value);
  return text + (unit === "%" ? "%" : unit ? " " + unit : "");
};

export const PitchChart = ({ chart }: { chart: TResearchGraph }) => {
  const unit = chart.data[0].unit;
  const tip = <Tooltip cursor={{ fill: "var(--paper-shade)", opacity: 0.5 }} formatter={value => [formatValue(Number(value), unit), chart.name]} />;
  return (
    <figure aria-label={chart.name} className="my-5 min-w-0 rounded-lg border border-border bg-card px-3 py-4 sm:px-5">
      <figcaption>
        <p className="text-base font-semibold text-foreground">{chart.name}</p>
        {chart.description && <p className="mt-1 text-sm leading-5 text-muted-foreground">{chart.description}</p>}
      </figcaption>
      <div className="my-3 min-w-0" style={{ height: chart.type === "line" ? 225 : Math.max(150, chart.data.length * 34 + 36) }}>
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          {chart.type === "bar" ? (
            <BarChart data={chart.data} layout="vertical" margin={{ top: 8, right: 12, bottom: 0, left: 0 }} accessibilityLayer>
              <CartesianGrid horizontal={false} stroke="var(--hairline)" strokeDasharray="2 4" />
              <XAxis type="number" tick={axisStyle} axisLine={false} tickLine={false} unit={unit === "%" ? "%" : undefined} />
              <YAxis type="category" dataKey="label" width={92} interval={0} tickFormatter={shortLabel} tick={axisStyle} axisLine={false} tickLine={false} />
              {tip}
              <Bar dataKey="value" fill="var(--plum)" barSize={17} radius={[0, 3, 3, 0]} isAnimationActive={false} />
            </BarChart>
          ) : (
            <LineChart data={chart.data} margin={{ top: 10, right: 18, bottom: 0, left: 0 }} accessibilityLayer>
              <CartesianGrid vertical={false} stroke="var(--hairline)" strokeDasharray="2 4" />
              <XAxis dataKey="label" minTickGap={16} tickFormatter={shortLabel} tick={axisStyle} axisLine={false} tickLine={false} />
              <YAxis width={46} tick={axisStyle} axisLine={false} tickLine={false} unit={unit === "%" ? "%" : undefined} />
              {tip}
              <Line dataKey="value" stroke="var(--plum)" strokeWidth={2.5} dot={{ r: 3 }} connectNulls={false} isAnimationActive={false} />
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
      <Collapsible className="border-t border-border pt-2 text-sm">
        <CollapsibleTrigger asChild><Button type="button" size="sm" variant="ghost"
          className="group gap-1.5 px-2 text-primary">
          Chart data and sources <ChevronDown size={14} className="group-data-[state=open]:rotate-180" aria-hidden="true" />
        </Button></CollapsibleTrigger>
        <CollapsibleContent className="mt-2 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">{chart.name} data</caption>
            <thead><tr><th scope="col" className="py-1">Label</th><th scope="col">Value</th><th scope="col">Period</th><th scope="col">Source</th></tr></thead>
            <tbody>{chart.data.map((point, index) => (
              <tr key={index} className="border-t border-border/70 align-top">
                <th scope="row" className="py-1.5 pr-2 font-normal">{point.label}</th>
                <td className="py-1.5 pr-2 tabular-nums">{formatValue(point.value, point.unit)}</td>
                <td className="py-1.5 pr-2">{point.period}</td>
                <td className="py-1.5"><a href={"#user-content-fn-" + point.evidence_id.toLowerCase()} title={point.evidence_id}
                  aria-label={"View source for " + point.label} className="text-primary underline underline-offset-2">View source</a></td>
              </tr>
            ))}</tbody>
          </table>
        </CollapsibleContent>
      </Collapsible>
    </figure>
  );
};
