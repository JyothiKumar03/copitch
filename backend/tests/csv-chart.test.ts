import { expect, test } from "bun:test";
import { csv_chart_candidates, read_csv } from "../src/services/source-csv";
import { source_evidence } from "../src/services/source";

const candidates = (csv: string, source_id = "upload") => {
  const data = read_csv(new TextEncoder().encode(csv));
  const rows = source_evidence({source_id,filename:"source.csv",kind:"csv",locations:data.records.length,...data});
  return csv_chart_candidates(rows);
};

test("CSV charts derive chronological counts and categorical prices directly from cells", () => {
  const users = candidates("month,active_users\n2025-03,0\nJanuary 2025,7\n");
  expect(users.map(c => c.point.value)).toEqual([0,7]);
  expect(users[0].date!).toBeGreaterThan(users[1].date!);
  expect(users[0].point.unit).toBe("count");
  const amounts = candidates('region,revenue_usd,customer_id\n"East; id: 9","$3,100.50",1001\nWest,-2,1002\n');
  expect(amounts).toHaveLength(2);
  expect(amounts[0].point).toMatchObject({value:3100.5,unit:"USD",label:"East; id: 9"});
  expect(amounts[0].group).toBe(amounts[1].group);
  expect(amounts[0].date).toBeNull();
  expect(candidates("region,revenue_usd\nEast,5\nWest,7","another")[0].group).not.toBe(amounts[0].group);
});

test("CSV charts preserve relative weeks and the source's declared unit", () => {
  const weekly = candidates("week,bookings,unit\nWeek 3,24,bookings\nWeek 1,12,bookings\nWeek 2,18,bookings");
  expect(weekly.map(({ date, point }) => [date, point.label, point.value, point.unit])).toEqual([
    [3,"Week 3",24,"bookings"], [1,"Week 1",12,"bookings"], [2,"Week 2",18,"bookings"],
  ]);
  expect(weekly.every(row => row.group === weekly[0].group)).toBe(true);
});

test("malformed or ambiguous series are withheld without coercing cells or inventing units", () => {
  for (const csv of [
    "month,users\n2025-02-30,3\n2025-03-01,4",
    "period,users\nJanuary,2\n2025-02,3",
    "region,users\nEast,1\neast,2",
    "region,users\nEast,2\nTotal,2",
    "region,cost\nEast,€2\nWest,£3",
    "region,cost,unit\nEast,2,USD\nWest,3,EUR",
    "region,cost_usd,unit\nEast,2,EUR\nWest,3,EUR",
    "region,cost,unit\nEast,2,USD\nWest,3,",
    "week,volume\nWeek 1,4\n2025-W02,1",
    "region,satisfaction_pct\nEast,60\nWest,=2+2",
    "segment,region,value\nRetail,East,7\nRetail,West,8",
    "region,postal_code,tracking_number\nEast,75001,1000\nWest,10001,1001",
    "region,value\nEast,3\nWest,",
  ]) expect(candidates(csv)).toEqual([]);
  expect(candidates("quarter,margin_pct\n2025-Q2,5%\nQ1 2025,0")[0].point.unit).toBe("%");
  expect(candidates("week,volume\n2021-W53,4\n2022-W01,1")).toEqual([]);
  expect(candidates("week,volume\n2020-W53,4\n2021-W01,1")).toHaveLength(2);
});
