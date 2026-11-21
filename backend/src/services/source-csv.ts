import type { TPitchChartCandidate } from "../types/pitch-artifact";
import type { TEvidence } from "../types/research";
import { parse } from "csv-parse/sync";
import { AppError } from "../errors/app-error";
import type { TConversionMetric, TSourceContent, TSourceRecord } from "../types/source";

const conversion_scope_version = 1;
const normalized = (label: string) => label.trim().toLowerCase().replace(/[\s_-]+/g, " ");
const count = (value: string | undefined) => {
  if (!value || !/^\d+$/.test(value.trim())) return;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : undefined;
};

const time_axis = /^(month|year|date|quarter|period|week|day)$/;
const category_axis = /^(region|country|state|province|city|market|segment|customer segment|category|channel|team|product|department|plan|cohort|platform|variant|group)$/;
const months = ["january","february","march","april","may","june","july","august","september","october","november","december"];

const period = (label: string) => {
  const year = /^(\d{4})$/.exec(label);
  if (year) return { date:Number(year[1]), scale:"year" };
  const iso = /^(\d{4})-(0[1-9]|1[0-2])(?:-(0[1-9]|[12]\d|3[01]))?$/.exec(label);
  if (iso) {
    const day = Date.parse(label + (iso[3] ? "" : "-01") + "T00:00:00Z");
    if (iso[3] && new Date(day).getUTCDate() !== Number(iso[3])) return;
    return { date:day, scale:iso[3] ? "day" : "month" };
  }
  const week = /^(\d{4})-W(0[1-9]|[1-4]\d|5[0-3])$/i.exec(label);
  if (week) {
    const january_fourth = Date.UTC(Number(week[1]),0,4);
    const weekday = (new Date(january_fourth).getUTCDay()+6)%7;
    const thursday = january_fourth + ((Number(week[2])-1)*7-weekday+3)*86400000;
    if (new Date(thursday).getUTCFullYear() === Number(week[1])) return {date:thursday,scale:"week"};
    return;
  }
  const relative_week = /^week\s+(0|[1-9]\d*)$/i.exec(label);
  if (relative_week) {
    const date = count(relative_week[1]);
    if (date !== undefined) return { date, scale:"relative week" };
    return;
  }
  const standalone_quarter = /^Q([1-4])$/i.exec(label);
  if (standalone_quarter) return {date:Number(standalone_quarter[1]),scale:"quarter without year"};
  const quarter = /^(?:(\d{4})[ -]?Q([1-4])|Q([1-4])[ -]?(\d{4}))$/i.exec(label);
  if (quarter) return { date:Number(quarter[1] ?? quarter[4])*4 + Number(quarter[2] ?? quarter[3]),scale:"quarter" };
  const named = /^([a-z]+)(?:[ -](\d{4}))?$/i.exec(label);
  if (!named) return;
  const month = months.findIndex(m => [m,m.slice(0,3)].includes(named[1].toLowerCase()));
  if (month >= 0) return {date:named[2] ? Date.parse(named[2]+"-"+String(month+1).padStart(2,"0")+"-01T00:00:00Z") : month,scale:named[2] ? "month" : "month without year"};
};

const column_unit = (name: string) => {
  if (/(?:^|\W)(%|pct|percent|percentage)(?:$|\W)/.test(name)) return "%";
  const unit = /(?:^|\W)(usd|eur|gbp|cad|aud|inr|ms|seconds|minutes|hours|days|kg|mb|gb)(?:$|\W)/.exec(name)?.[1];
  if (unit) return /^(usd|eur|gbp|cad|aud|inr)$/.test(unit) ? unit.toUpperCase() : unit;
  if (/(?:^| )(?:users|orders|customers|accounts|requests|sessions|visits|trials|conversions|units|count)$/.test(name)) return "count";
};

const numeric_cell = (raw: string, header_unit?: string) => {
  const match = /^([€£$])?(-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)(%)?$/.exec(raw.trim());
  if (!match || (match[1] && match[3]) || /^-?0\d/.test(match[2])) return;
  const cell_unit = match[1] === "€" ? "EUR" : match[1] === "£" ? "GBP" : match[1] || match[3];
  if (cell_unit && header_unit && cell_unit !== header_unit &&
      !(cell_unit === "$" && ["USD","CAD","AUD"].includes(header_unit))) return;
  const digits = match[2].replaceAll(",","");
  if (digits.includes(".") && digits.replace(/[-.]/g,"").replace(/^0+/,"").length > 15) return;
  const value = Number(digits);
  if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) return;
  return {value,unit:header_unit ?? cell_unit ?? "value"};
};

// A whole column must agree on its labels, numeric representation and unit before it becomes chartable.
const attach_observations = (header: string[], names: string[], data: string[][], records: TSourceRecord[]) => {
  const axes = names.flatMap((name,i) => time_axis.test(name) || category_axis.test(name) ? [i] : []);
  if (axes.length !== 1 || records.length < 2) return;
  const axis = axes[0];
  const temporal = time_axis.test(names[axis]);
  const labels = records.map(row => data[row.number-2][axis].trim());
  if (labels.some(l => !l || l.length > 100 || /^(all|overall|total|subtotal|grand total)$/i.test(l)) ||
    new Set(labels.map(l => l.toLowerCase())).size !== labels.length) return;
  const periods = labels.map(label => temporal ? period(label) : undefined);
  if (temporal && (periods.some(p => !p) || new Set(periods.map(p => p?.scale)).size !== 1 ||
      new Set(periods.map(p => p?.date)).size !== periods.length)) return;
  const unit_column = names.indexOf("unit");
  const units = unit_column < 0 ? [] : records.map(row => data[row.number-2][unit_column].trim());
  const declared_unit = units[0];
  if (unit_column >= 0 && (!declared_unit || units.some(unit => unit !== declared_unit))) return;
  for (const [column,name] of names.entries()) {
    if (column === axis || column === unit_column || !/\p{L}/u.test(name) || /(?:^|\W)(id|ids|identifier|code|zip|postal|sku|uuid|phone|number of record|serial|latitude|longitude|index)(?:$|\W)/.test(name) ||
        /^(?:[a-z]+id|row number|account number|phone number|order number|invoice number|customer number|tracking number)$/.test(name)) continue;
    const header_unit = column_unit(name);
    if (declared_unit && header_unit && declared_unit !== header_unit) continue;
    const values = records.map(row => numeric_cell(data[row.number-2][column],declared_unit ?? header_unit));
    if (values.some(v => !v) || new Set(values.map(v => v?.unit)).size !== 1) continue;
    records.forEach((row,i) => {
      const observation = values[i]!;
      (row.numeric_series ??= []).push({column, measure:header[column].trim().replaceAll("_"," "),
        axis:header[axis].trim(), label:labels[i], date:periods[i]?.date ?? null, ...observation});
    });
  }
};

export const csv_chart_candidates = (evidence: TEvidence[]): TPitchChartCandidate[] => evidence.flatMap(row =>
  row.source_id && row.origin === "material" ? (row.numeric_series ?? []).map(observation => ({
    id:row.id + "-csv-" + observation.column,
    group:JSON.stringify([row.source_id, "csv", observation.column, observation.axis, observation.unit]),
    measure:observation.measure, date:observation.date,
    point:{label:observation.label,value:observation.value,unit:observation.unit,evidence_id:row.id},
  })) : []);

export const read_csv = (bytes: Uint8Array): TSourceContent => {
  const csv = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (bytes.length > 256000 || csv.includes("\0")) throw new AppError(422,"Supply a UTF-8 CSV of at most 256 KB");
  const data: string[][] = parse(csv, { bom: true, max_record_size: 5000, relax_column_count: true });
  const header = data.shift();
  if (!header?.length || header.length > 60 || header.some(h => !h.trim())) throw new AppError(422,"CSV needs a nonempty header row");
  const names = header.map(normalized);
  if (new Set(names).size !== names.length) throw new AppError(422,"CSV column names must be distinct");
  const field = (...matches: string[]) => names.findIndex(n => matches.includes(n));
  const numerator_col = field("conversions","converted","converted trials","conversion count","numerator");
  const denominator_col = field("trials","total trials","trial count","denominator");
  const month_col = field("month","period");
  const segment_col = field("segment","customer segment","cohort","group");
  const unpartitioned = ["cohort", "group"].includes(names[segment_col]);
  const records: TSourceRecord[] = [];
  let invalid_counts = 0;
  let characters = 0;
  for (const [index, cells] of data.entries()) {
    if (cells.length === 1 && !cells[0].trim()) continue;
    if (cells.length !== header.length) throw new AppError(422,`CSV row ${index + 2} has the wrong number of fields`);
    const text = header.map((name, col) => name.trim() + ": " + cells[col].trim()).join("; ");
    characters += text.length;
    if (characters > 32000 || records.length >= 250) throw new AppError(422,"CSV exceeds 250 rows or 32,000 extracted characters");
    let metric: TConversionMetric | undefined;
    if (numerator_col >= 0 && denominator_col >= 0) {
      const segment = cells[segment_col]?.trim() || null;
      const month = cells[month_col]?.trim() || null;
      const summary_period = month && /^(all|overall|total|subtotal|grand total)$/i.test(month);
      if (!summary_period && !/^subtotal$/i.test(segment ?? "")) {
        const numerator = count(cells[numerator_col]);
        const denominator = count(cells[denominator_col]);
        if (numerator !== undefined && denominator !== undefined && numerator <= denominator) {
          metric = { month,segment,numerator,denominator,ratio: denominator ? numerator / denominator : null,
            ...(unpartitioned && { unpartitioned: true }) };
        } else invalid_counts++;
      }
    }
    records.push({ number: index + 2, text, ...(metric && { metric }) });
  }
  // A partial group could misrepresent the rate. Keep raw cells but withhold all calculated rates in this file.
  if (invalid_counts) for (const row of records) delete row.metric;
  attach_observations(header,names,data,records);
  const gaps = invalid_counts ? [`Conversion totals withheld because ${invalid_counts} row(s) have invalid trial counts.`] : [];
  return { records, gaps, ...(numerator_col >= 0 && denominator_col >= 0 && { conversion_scope_version }) };
};
