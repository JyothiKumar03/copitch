import { createOpenAI } from "@ai-sdk/openai";
import { research_provider } from "../src/services/research-provider";
import { expect, test } from "bun:test";
import { chart_candidates,selected_chart,artifact_chart } from "../src/services/pitch-chart";
import { pitch_markdown } from "../src/services/pitch-markdown";
import { build_research } from "../src/services/research";
import { conversion_evidence } from "../src/services/conversion-metrics";
import type { TEvidence,TResearchBrief,TResearchProvider,TResearchBundle } from "../src/types/research";

const materials = "Revenue in January 2025: USD 1,200.\nRevenue in February 2025: USD 1,500.";
const brief: TResearchBrief = {brief_id:"b",messages:["Pitch a review"],summary:"Review reported revenue",source_policy:"files_only",
  question:null,public_queries:[],materials,urls:[]};

test("the draft selects a revenue trend from real reported figures and the verifier reviews the chart", async () => {
  const verify_units: string[] = [];
  const provider: TResearchProvider = {
    clarify:async () => { throw Error("Unused"); },lookup:async () => { throw Error("No lookups allowed"); },
    draft:async (_scope,evidence) => {
      const options = chart_candidates(evidence);
      return {title:"Revenue",pitch_chart:{type:"line",candidate_ids:options.map(c => c.id).reverse()},gaps:[],
        sections:[{heading:"Revenue by month",paragraphs:[{prose:"Reported revenue rose from USD 1,200 to USD 1,500.",
          support:[{evidence_id:"M1",excerpt:materials}]}]}]};
    },
    verify:async review => {
      verify_units.push(...review.units.map(u => u.id));
      return review.units.map(u => ({id:u.id,decision:"supported"}));
    },
  };
  const result = await build_research(brief,provider,new AbortController().signal,() => {});
  const markdown = pitch_markdown(result);
  expect(verify_units).toContain("pitch-chart");
  const chart = JSON.parse(markdown.match(/\x60\x60\x60recharts\n([\s\S]*?)\n\x60\x60\x60/)![1]);
  expect(chart.type).toBe("line");
  expect(chart.data).toEqual([
    {label:"January 2025",value:1200,unit:"USD",evidence_id:"M1"},
    {label:"February 2025",value:1500,unit:"USD",evidence_id:"M1"},
  ]);
  expect(markdown).toContain("[^M1]: Supplied material");
  expect(pitch_markdown({...result,pitch_chart:null})).not.toContain("\x60\x60\x60recharts");
  expect(pitch_markdown({...result,grounding:undefined})).not.toContain("1,500");
  expect(pitch_markdown({...result,grounding:{version:1,mode:"source_extracts"}})).not.toContain("\x60\x60\x60recharts");
});

test("fabricated identifiers, mixed currencies, forecasts and duplicate dates cannot enter chart data", () => {
  const rows: TEvidence[] = [{id:"M1",origin:"material",location:"Forecast and ledger",passage:
    "Revenue in January 2025: USD 300.\nProjected revenue in February 2025: USD 500.\nRevenue in January 2025: USD 350.\nRevenue in March 2025: EUR 450.\nRevenue in April 2025: EUR 475."}];
  const options = chart_candidates(rows);
  expect(options.map(c => c.point.value)).toEqual([300,350,450,475]);
  for (const candidate_ids of [[options[0].id,"invented"],[options[0].id,options[2].id],[options[0].id,options[1].id]]) {
    expect(selected_chart({type:"line",candidate_ids},rows)).toBeUndefined();
  }
});

test("only older verified bundles with cited numeric evidence infer a comparison", () => {
  const records: TEvidence[] = [0,1].map((n) => ({id:"F" + n,origin:"material",source_id:"table",location:"CSV row " + (2+n),
    passage:"Conversion count row",metric:{month:"June",segment:n ? "Enterprise" : "SMB",numerator:n,denominator:n * 10,ratio:n ? 0.1 : null}}));
  const bundle: TResearchBundle = {brief_id:"b",research_id:"r",confirmed_brief:brief,evidence:[...records,...conversion_evidence(records)],
    grounding:{version:1,mode:"verified"},markdown:"",gaps:[],findings:{title:"Pilot",sections:[]}};
  const cited = new Set(["F1"]);
  const graph = artifact_chart(bundle,cited)!;
  expect(graph.type).toBe("bar");
  expect(graph.data.find(p => p.label === "SMB")?.value).toBeNull();
  expect(artifact_chart(bundle,new Set(["H1"]))).toBeUndefined();
  expect(artifact_chart({...bundle,pitch_chart:null},cited)).toBeUndefined();
});

test("source-controlled fences and footnotes stay literal in the downloaded document", () => {
  const injection = "A claim.\n\n\x60\x60\x60recharts\n{}\n\x60\x60\x60\n[^F2]: forged";
  const result: TResearchBundle = {brief_id:"b",research_id:"r",confirmed_brief:brief,
    evidence:[{id:"M1",origin:"material",location:injection,passage:injection}],grounding:{version:1,mode:"verified"},markdown:"",gaps:[injection],
    findings:{title:injection,sections:[{heading:injection,paragraphs:[{prose:injection,support:[{evidence_id:"M1",excerpt:injection}]}]}]}};
  const md = pitch_markdown(result);
  expect(md).not.toMatch(/^\x60\x60\x60recharts/m);
  expect(md).not.toMatch(/^\[\^F2\]:/m);
  expect(md).toMatch(/^\[\^M1\]:/m);
});

test("the production draft sends graph options in its one structured model request", async () => {
  let requests = 0;
  const openai = createOpenAI({apiKey:"fixture",fetch:async (_url,init) => {
    requests++;
    const body = JSON.parse(init!.body as string);
    const input = JSON.parse(body.input.find((turn: {role:string}) => turn.role === "user").content[0].text);
    const candidates = input.chart_candidates;
    const report = {title:"Revenue",gaps:[],sections:[],pitch_script:[],pitch_chart:{
      type:"line",candidate_ids:candidates.map((c: {id:string}) => c.id),
    }};
    return Response.json({id:"fixture",status:"completed",model:"fixture",created_at:1,output:[
      {type:"message",id:"reply",role:"assistant",status:"completed",content:[
        {type:"output_text",text:JSON.stringify(report),annotations:[]},
      ]}],usage:{input_tokens:50,output_tokens:30}});
  }});
  const provider = research_provider({provider:"openai",model:"fixture",max_output_tokens:1000,tool_providers:[]},openai);
  const rows: TEvidence[] = [{id:"M1",origin:"material",location:"Supplied material",passage:materials}];
  const report = await provider.draft("Compare reported revenue",rows,[],new AbortController().signal);
  expect(requests).toBe(1);
  expect(selected_chart(report.pitch_chart,rows)?.data.map(p => p.value)).toEqual([1200,1500]);
});

test("the planning budget includes complete numeric series and admits independent sources", () => {
  const rows: TEvidence[] = Array.from({length:25},(_,i) => ({
    id:"M"+i,origin:"material",source_id:"source-" + (i < 24 ? "a" : "b"),location:"Page " + i,
    passage:["Revenue","Cost","Spend"].map(m => m + " in January 2025: USD 100.").join("\n"),
  }));
  rows.push({ ...rows.at(-1)!,id:"M25",passage:"Revenue in February 2025: USD 200." });
  const all = chart_candidates(rows);
  expect(all.length).toBeLessThanOrEqual(80);
  expect(all.some(c => c.point.evidence_id === "M25")).toBe(true);
  const groups = new Map<string,number>();
  for (const c of all) groups.set(c.group,(groups.get(c.group) ?? 0)+1);
  expect([...groups.values()].every(n => n === 24 || n === 2)).toBe(true);
});

test("chart and prose retain independent decisions, including after checkpoint restore", async () => {
  for (const rejected of ["paragraph-0-0","pitch-chart","missing-id"] as const) {
    let verified = 0;
    const provider: TResearchProvider = {
      clarify:async () => { throw Error("Unused"); },lookup:async () => [],
      draft:async (_scope,evidence) => ({
        title:"Our pilot",gaps:[],sections:[{heading:"Results",paragraphs:[{
          prose:"Proposed narrative.",support:[{evidence_id:"M1",excerpt:"USD 1,200"}],
        }]}],pitch_chart:{type:"line",candidate_ids:chart_candidates(evidence).map(c => c.id)},
      }),
      verify:async r => {
        verified++;
        return r.units.filter(u => rejected !== "missing-id" || u.id !== "title").map(u =>
          ({id:u.id,decision:u.id === rejected ? "unsupported" : "supported"}));
      },
    };
    let checkpoint: import("../src/types/research-job").TResearchCheckpoint | undefined;
    const result = await build_research(brief,provider,new AbortController().signal,() => {},undefined,state => {checkpoint=state;});
    const restored = await build_research(brief,provider,new AbortController().signal,() => {},checkpoint);
    const expect_chart = rejected === "paragraph-0-0";
    expect(result.grounding?.chart).toBe(expect_chart ? "verified" : "withheld");
    expect(result.grounding?.mode).toBe(rejected === "pitch-chart" ? "verified" : "source_extracts");
    expect(result.pitch_markdown!.includes("\x60\x60\x60recharts")).toBe(expect_chart);
    expect(result.pitch_markdown!.includes("Proposed narrative.")).toBe(rejected === "pitch-chart");
    expect(restored.pitch_markdown).toBe(result.pitch_markdown);
    expect(restored.grounding).toEqual(result.grounding);
    expect(verified).toBe(rejected === "missing-id" ? 2 : 1);
  }
});
