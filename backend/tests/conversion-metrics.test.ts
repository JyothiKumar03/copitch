import { expect, test } from "bun:test";
import { conversion_evidence } from "../src/services/conversion-metrics";
import { chart_candidates } from "../src/services/pitch-chart";
import { parse_source, source_evidence } from "../src/services/source";

test("a reported total stays separate from its nested segment or cohort through CSV ingestion and charting", async () => {
  for (const header of ["segment", "cohort", "group"]) {
    const source = await parse_source("Trial results.csv", Buffer.from([
      `${header},converted,trials,definition`,
      "Enterprise,4,20,Enterprise trial cohort",
      "Overall,10,100,All trials including Enterprise",
      "Subtotal,4,20,Repeated Enterprise counts",
    ].join("\n")));
    const rows = source_evidence(source);
    const metrics = conversion_evidence(rows);
    expect(metrics.find(row => row.metric?.segment === null)).toMatchObject({
      metric: { numerator: 10, denominator: 100, ratio: 0.1 },
      derived_from: [rows[1].id],
    });
    expect(metrics.find(row => row.metric?.segment === "Enterprise")).toMatchObject({
      metric: { numerator: 4, denominator: 20, ratio: 0.2 },
      derived_from: [rows[0].id],
    });
    const points = chart_candidates([...rows, ...metrics]).map(candidate => candidate.point);
    expect(points).toHaveLength(2);
    expect(points).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "Overall", value: 10, denominator: 100 }),
      expect.objectContaining({ label: "Enterprise", value: 20, denominator: 20 }),
    ]));
  }
});

test("conflicting reported totals and unpartitioned cohorts never create a synthetic overall denominator", async () => {
  const report = ["cohort,converted,trials", "Enterprise,4,20", "Supported,5,30"];
  const conflicts = [...report, "Overall,10,100", "All,14,120"];
  for (const csv of [report, conflicts]) {
    const source = await parse_source("Trial results.csv", Buffer.from(csv.join("\n")));
    const metrics = conversion_evidence(source_evidence(source));
    expect(metrics.map(row => row.metric?.segment)).toEqual(["Enterprise", "Supported"]);
  }
});

test("legacy misclassified totals remain readable without authorizing a fresh incorrect rollup", async () => {
  const source = await parse_source("Trial results.csv", Buffer.from("cohort,converted,trials\nEnterprise,4,20\nOverall,10,100"));
  const rows = source_evidence({ ...source, conversion_scope_version: undefined });
  expect(rows.map(row => row.passage)).toEqual(source.records.map(row => row.text));
  expect(conversion_evidence(rows)).toEqual([]);
});
