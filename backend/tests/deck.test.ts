import { api_error } from "../src/middleware/api-error";
import { serve_api } from "./helpers/serve-api";
import { expect, test } from "bun:test";
import { live_turn_handler } from "../src/controllers/live-turn";
import app, { create_api } from "../src/app";
import { database } from "../src/repositories/store";
import { compile_deck } from "../src/services/deck";
import type { TDeck, TEditProposal } from "../src/types/deck";
import type { TResearchBundle } from "../src/types/research";

const research_fixture = (): TResearchBundle => {
  const brief_id = crypto.randomUUID();
  const passage = "42 people enrolled. The study ran for three weeks.";
  return {
    research_id: crypto.randomUUID(), brief_id, markdown: "Markdown is a separate export.",
    gaps: [], confirmed_brief: { brief_id, source_policy: "files_only", messages: ["Explain the trial."],
      materials: passage, urls: [], summary: "The trial", question: null, public_queries: [] },
    evidence: [{ id: "M1", origin: "material", location: "Trial notes", passage }],
    findings: { title: "Trial evidence", sections: ["Enrollment","Timeline","Takeaway"].map(heading => ({
      heading, paragraphs: [{ prose: passage, support: [{ evidence_id: "M1", excerpt: "42 people enrolled" }] }],
    })) },
  };
};

test("compiler selects approved layouts, includes complete narration and validates saved references", () => {
  const bundle = research_fixture();
  const deck = compile_deck(bundle);
  expect(deck.slides.map(slide => slide.layout)).toEqual(["headline","evidence","takeaway"]);
  expect(deck.slides[0].highlights).toEqual(["42 people enrolled."]);
  expect(deck.slides[0].narration).toContain("three weeks");
  expect(deck.slides[0].evidence_ids).toEqual(["M1"]);
  expect(compile_deck(bundle).slides).toEqual(deck.slides);
  bundle.findings.sections[0].paragraphs[0].support[0].excerpt = "absent";
  expect(() => compile_deck(bundle)).toThrow("unresolved evidence");
  bundle.findings.sections = [];
  expect(() => compile_deck(bundle)).toThrow("No supported findings");
});

test("deck API pins revisions, scopes changes to the host and resolves duplicate and racing decisions", async () => {
  process.env.AI_SESSION_DB = ":memory:";
  await using http = await serve_api(app);
  const register = async () => (await http.request("/api/sessions", { method: "POST" })).json() as Promise<{session_id: string;token:string}>;
  const host = await register();
  const other = await register();
  const bundle = research_fixture();
  const store = database();
  store.replace_brief(host.session_id, undefined, bundle.confirmed_brief);
  store.save_research(host.session_id,bundle);
  const request = (path: string, body?: unknown, session = host) => http.request("/api/sessions/" + session.session_id + path,{
    method: body ? "POST" : "GET",
    headers: { Authorization: "Bearer " + session.token, "Content-Type": "application/json" },
    ...(body && { body: JSON.stringify(body) }),
  });
  const create = () => request("/decks",{ research_id: bundle.research_id });
  const initial = await (await create()).json() as TDeck;
  expect(initial.revision).toBe(1);
  expect((await (await create()).json()).deck_id).toBe(initial.deck_id);
  const path = "/decks/" + initial.deck_id;
  expect((await request(path,undefined,other)).status).toBe(404);
  const input = { command_id: "one", base_revision: 1, slide_id: initial.slides[0].slide_id, changes: { title: "Edited title" } };
  const edit = (body: unknown) => request(path + "/edits",body);
  const proposed = await (await edit(input)).json() as TEditProposal;
  expect(proposed.status).toBe("pending");
  expect(proposed.before.title).toBe("Enrollment");
  expect(proposed.after.title).toBe("Edited title");
  expect((await (await edit(input)).json()).proposal_id).toBe(proposed.proposal_id);
  expect((await edit({ ...input,changes:{ title:"Different command" } })).status).toBe(409);
  expect((await edit({ ...input,changes:{ title:"<script>bad()</script>" } })).status).toBe(400);
  expect((await edit({ ...input,changes:{ evidence_ids:["fabricated"] } })).status).toBe(400);
  const competitor = await (await edit({ ...input, command_id:"two", changes:{ narration:"Host notes" } })).json() as TEditProposal;
  expect((await (await request(path)).json()).revision).toBe(1);
  const decision = (id:string, value:string) => request(path + "/edits/" + id + "/decision",{ decision:value });
  const approved = await (await decision(proposed.proposal_id,"approve")).json() as TEditProposal;
  expect(approved.approved_revision).toBe(2);
  expect((await (await decision(proposed.proposal_id,"approve")).json()).approved_revision).toBe(2);
  expect((await decision(proposed.proposal_id,"reject")).status).toBe(409);
  expect((await decision(competitor.proposal_id,"approve")).status).toBe(409);
  expect((await (await decision(competitor.proposal_id,"reject")).json()).status).toBe("rejected");
  const latest = await (await request(path)).json() as TDeck;
  expect(latest.revision).toBe(2);
  expect(latest.slides[0].title).toBe("Edited title");
  expect(latest.slides[0].narration).toBe(initial.slides[0].narration);
  expect(await (await request(path + "?revision=1")).json()).toEqual(initial);
  expect((await request(path + "/edits/" + proposed.proposal_id,undefined,other)).status).toBe(404);
  expect((await request(path + "/edits/" + proposed.proposal_id)).status).toBe(200);
});

test("live turns cite bounded evidence, reuse concurrent replies and fence stale edits", async () => {
  process.env.AI_SESSION_DB = ":memory:";
  await using http = await serve_api(app);
  const host = await (await http.request("/api/sessions",{ method:"POST" })).json();
  const db = database();
  const bundle = research_fixture();
  db.replace_brief(host.session_id,undefined,bundle.confirmed_brief);
  db.save_research(host.session_id,bundle);
  const deck = db.decks.create(host.session_id,compile_deck(bundle));
  let calls = 0;
  let resume_model: (() => void) | undefined;
  const wait = new Promise<void>(resolve => { resume_model = resolve; });
  let entering: (() => void) | undefined;
  const entered = new Promise<void>(resolve => { entering = resolve; });
  const fixture = create_api();
  fixture.post("/:session_id/:deck_id",live_turn_handler(async context => {
    calls++;
    expect(context.evidence).toHaveLength(1);
    if (context.message === "unknown") return { kind:"answer", text:"Unknown claim", support:[{ evidence_id:"fake",excerpt:"bad" }] };
    if (context.message === "edit later") {
      entering?.();
      await wait;
    }
    if (context.message.startsWith("edit")) return { kind:"edit", text:"A proposed edit.", changes:{ title:"New title" } };
    return { kind:"answer", text:"42 people participated.", support:[{ evidence_id:"M1",excerpt:"42 people enrolled" }] };
  }));
  fixture.use(api_error);
  await using server = await serve_api(fixture);
  const request = (id:string,message:string,token = host.token) => server.request("/" + host.session_id + "/" + deck.deck_id,{
    method:"POST",headers:{ Authorization:"Bearer " + token, "Content-Type":"application/json" },
    body:JSON.stringify({ turn_id:id,base_revision:1,slide_id:deck.slides[0].slide_id,message }),
  });
  expect((await request("a","how many?","wrong")).status).toBe(401);
  const replies = await Promise.all([request("a","how many?"),request("a","how many?")]);
  expect(await replies[0].json()).toEqual({ kind:"answer",text:"42 people participated.",evidence_ids:["M1"] });
  expect(await replies[1].json()).toEqual({ kind:"answer",text:"42 people participated.",evidence_ids:["M1"] });
  expect(calls).toBe(1);
  expect((await request("a","changed request")).status).toBe(409);
  expect((await (await request("b","unknown")).json()).kind).toBe("clarify");
  const edit = await (await request("c","edit now")).json();
  expect(edit.proposal.status).toBe("pending");
  expect((await (await request("c","edit now")).json()).proposal.proposal_id).toBe(edit.proposal.proposal_id);
  expect(db.decks.get(host.session_id,deck.deck_id)?.revision).toBe(1);
  const pending = request("d","edit later");
  await entered;
  db.decks.decide(host.session_id,deck.deck_id,edit.proposal.proposal_id,"approve");
  resume_model?.();
  expect((await pending).status).toBe(409);
  expect(db.decks.get(host.session_id,deck.deck_id)?.revision).toBe(2);
});
