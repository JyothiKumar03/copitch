import { chart_candidates } from "../src/services/pitch-chart";
import { expect, test } from "bun:test";
import { create_api } from "../src/app";
import { create_session } from "../src/controllers/session";
import { research_handlers } from "../src/controllers/research";
import { database } from "../src/repositories/store";
import { api_error } from "../src/middleware/api-error";
import { research } from "../src/routes/research";
import { interview } from "../src/routes/interview";
import type { TEvidence, TResearchProvider } from "../src/types/research";
import { serve_api } from "./helpers/serve-api";

test("review binds private PDF pages, ordered PPTX slides and CSV rows to the authenticated research revision", async () => {
  process.env.AI_SESSION_DB = ":memory:";
  let lookups = 0;
  let inspected: TEvidence[] = [];
  let interview_scope = "";
  const provider: TResearchProvider = {
    clarify: async scope => { interview_scope = JSON.stringify(scope); return {summary:"Review our pilot.", question:null, public_queries:[]}; },
    lookup: async () => { lookups++; return []; },
    draft: async (_brief,evidence) => {
      inspected = evidence;
      const records = ["Pilot brief.pdf, page 2","Buyer pitch.pptx, slide 3","Monthly trials.csv, CSV row 2"]
        .map(locator => evidence.find(e => e.location === locator)!);
      const candidates = chart_candidates(evidence).filter(c => c.id.endsWith("-segment") && c.measure === "Conversion rate · Jan");
      return {title:"Pilot",pitch_chart:{type:"bar",candidate_ids:candidates.map(c => c.id)},sections:[{heading:"Evidence",paragraphs:records.map(r => ({
        prose:r.passage,support:[{ evidence_id:r.id,excerpt:r.passage }],
      }))}],gaps:[]};
    },
    verify: async review => review.units.map(u => ({id:u.id,decision:"supported"})),
  };
  const handlers = research_handlers(() => provider);
  const app = create_api(interview);
  app.post("/api/sessions",create_session);
  app.post("/api/sessions/:session_id/research/brief",handlers.review);
  app.post("/api/sessions/:session_id/research",handlers.build);
  app.use("/api/sessions",research);
  app.use(api_error);
  await using http = await serve_api(app);
  const new_session = async () => (await http.request("/api/sessions",{method:"POST"})).json();
  const host = await new_session();
  const other = await new_session();
  const base = "/api/sessions/" + host.session_id;
  const auth = { Authorization:"Bearer " + host.token };
  const send = (path:string, body:unknown, owner = host) => http.request("/api/sessions/" + owner.session_id + path,{
    method:"POST",headers:{Authorization:"Bearer " + owner.token,"Content-Type":"application/json"},body:JSON.stringify(body),
  });
  const upload = (file: Blob, name:string, headers:Record<string,string> = auth) => {
    const form = new FormData();
    form.append("file",file,name);
    return http.request(base + "/research/sources",{method:"POST",headers,body:form});
  };
  expect((await upload(new Blob(["secret"]),"data.csv",{})).status).toBe(401);
  const workspace = await (await http.request(base + "/interview/workspace",{headers:auth})).json();
  expect(workspace.capabilities.source_uploads).toBe(true);
  expect((await upload(new Blob(["wrong"]),"private.exe")).status).toBe(415);
  expect((await upload(new Blob(["not a pdf"]),"private.pdf")).status).toBe(422);
  expect((await upload(new Blob([new Uint8Array(8 * 1024 * 1024 + 1)]),"large.csv")).status).toBe(413);
  const ids: string[] = [];
  for (const [name,locations] of [["Pilot brief.pdf",2],["Buyer pitch.pptx",3],["Monthly trials.csv",4]] as const) {
    const fixture = Bun.file(new URL("./fixtures/sources/" + name,import.meta.url));
    const res = await upload(fixture,name);
    expect(res.status).toBe(201);
    const meta = await res.json();
    expect(meta).toMatchObject({filename:name,locations});
    ids.push(meta.source_id);
    if (name.endsWith("csv")) expect((await (await upload(fixture,name)).json()).source_id).toBe(meta.source_id);
  }
  const input = {source_policy:"files_only",message:"Summarize the supplied evidence.",source_ids:ids};
  expect((await send("/research/brief",input,other)).status).toBe(404);
  const reviewed = await (await send("/research/brief",input)).json();
  expect(reviewed.sources.map((s:{source_id:string}) => s.source_id)).toEqual(ids);
  const second = await (await send("/research/brief",{brief_id:reviewed.brief_id,message:"For the buyer.",source_policy:"files_only"})).json();
  expect(second.sources).toEqual(reviewed.sources);
  const restored = await (await http.request(base + "/interview/workspace",{headers:auth})).json();
  expect(restored.brief.sources).toEqual(second.sources);
  expect(interview_scope).not.toContain("Monthly trials.csv");
  expect(interview_scope).not.toContain("Small sample");
  const result = await (await send("/research",{brief_id:second.brief_id,confirmed:true})).json();
  expect(result.markdown).toContain("Pilot brief.pdf, page 2");
  expect(result.markdown).toContain("Buyer pitch.pptx, slide 3");
  expect(result.markdown).toContain("Decision Approve two pilot seats");
  expect(result.markdown).toContain("Monthly trials.csv, CSV row 2");
  const pitch_url = base + "/research/" + result.research_id + "/pitch.md";
  expect((await http.request(pitch_url)).status).toBe(401);
  expect((await http.request("/api/sessions/" + other.session_id + "/research/" + result.research_id + "/pitch.md",{
    headers:{Authorization:"Bearer " + other.token},
  })).status).toBe(404);
  const download = await http.request(pitch_url,{headers:auth});
  expect(download.headers.get("Content-Disposition")).toBe('attachment; filename="pitch.md"');
  expect(download.headers.get("Cache-Control")).toBe("private, no-store");
  const markdown = await download.text();
  const reloaded = database().research_by_id(host.session_id,result.research_id)!;
  expect(reloaded.pitch_markdown).toBe(markdown);
  expect(await (await http.request(pitch_url,{headers:auth})).text()).toBe(reloaded.pitch_markdown);
  const spec = JSON.parse(markdown.match(/\x60\x60\x60recharts\n([\s\S]*?)\n\x60\x60\x60/)![1]);
  expect(spec.data.find((r: {label:string}) => r.label === "Overall")).toMatchObject({value:10,numerator:10,denominator:100,unit:"%"});
  expect(spec.data.find((r: {label:string}) => r.label === "enterprise")).toMatchObject({value:20,numerator:4,denominator:20,unit:"%"});
  for (const row of spec.data) expect(markdown).toContain("[^" + row.evidence_id + "]:");
  expect(lookups).toBe(0);
  const metric = (month:string,segment:string|null) => inspected.find(row =>
    row.derived_from && row.metric?.month === month && row.metric.segment === segment)?.metric;
  expect(metric("Jan",null)).toEqual({month:"Jan",segment:null,numerator:10,denominator:100,ratio:0.1});
  expect(metric("Feb","enterprise")?.ratio).toBeNull();
  expect(new Set(inspected.map(e => e.id)).size).toBe(inspected.length);
  expect(database().research_by_id(host.session_id,result.research_id)?.evidence).toEqual(inspected);
});
