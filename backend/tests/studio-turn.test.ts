import { expect, test } from "bun:test";
import { SessionStore } from "../src/repositories/session";
import { interview_workspace } from "../src/services/interview";
import { run_studio_turn } from "../src/services/studio-turn";
import type { TStudioProposal } from "../src/services/studio-intent";
import type { TStudioTurnInput } from "../src/types/studio-turn";

const proposed = (intent: TStudioProposal["intent"], data: Partial<TStudioProposal> = {}): TStudioProposal => ({
  intent, language: "en", subject: null, audience: null, decision: null, fact: null, source_phrase: null, source_url: null, ...data,
});

const studio = () => {
  const db = new SessionStore(":memory:");
  const session = crypto.randomUUID();
  const jobs: string[] = [];
  const services = {
    ensure_research: () => {}, wake: (id: string) => { jobs.push(id); },
    provider: {
      propose: async ({ message }: { message: string }) => {
        if (message === "Make a deck about me.") return proposed("brief", { subject: "me" });
        if (message === "It is JK-IFNA.") return proposed("correction", { subject: "JK-IFNA" });
        if (message === "Could you read the PDF?") return proposed("file_question");
        if (message === "Does any file confirm a moon mission?") return proposed("file_question");
        if (message === "What's on the slide?") return proposed("file_question");
        if (message === "What does the CSV say?") return proposed("file_question");
        if (message === "Proceed with everything you want") return proposed("approval");
        return proposed("unsupported");
      },
      excerpts: async (question: string, evidence: { id: string; passage: string }[]) => ({ citations: evidence.map(line => ({
        evidence_id: line.id, excerpt: question.includes("moon") ? "The moon mission was confirmed." : line.passage,
      })) }),
    },
  };
  const input = (message: string, partial: Partial<TStudioTurnInput> = {}): TStudioTurnInput => ({
    turn_id: crypto.randomUUID(), message, input: "typed", brief_id: db.current_brief(session)?.brief_id, ...partial,
  });
  const send = (message: string, partial: Partial<TStudioTurnInput> = {}) => run_studio_turn(db, session, input(message, partial), services);
  return { db, session, pending: () => interview_workspace(session, db).pending_question, jobs, send, input, services };
};

test("language and open decisions survive reopen, and only the current approved scope queues once", async () => {
  const { db, session, jobs, send, pending, input, services } = studio();
  expect((await send("Hi!", { source_policy: "files_only" })).intent).toBe("greeting");
  expect(interview_workspace(session, db).context?.source_policy).toBe("files_only");
  expect(interview_workspace(session, db).brief).toBeNull();
  expect(interview_workspace(session, db).history.map(turn => turn.role)).toEqual(["host", "assistant"]);
  await send("Please reply in Hindi from now on.");
  expect(db.studio.language_preference(session)).toBe("hi");
  const pitch = await send("Make a deck about me.");
  expect(db.studio.reply_language(session, pitch.turn_id)).toBe("hi");
  const audience = pending()!;
  expect(audience.kind).toBe("audience");
  await send("What language are you speaking?");
  expect(pending()!.request_id).toBe(audience.request_id);
  await send("Board", { answer_to: audience.request_id, option_id: "board" });
  const decision = pending()!;
  expect(decision.kind).toBe("decision");
  await expect(send("Potential buyers", { answer_to: audience.request_id, option_id: "buyers" })).rejects.toThrow("no longer open");
  await expect(send("Invented choice", { answer_to: decision.request_id, option_id: "invented" })).rejects.toThrow("offered");
  await send("Approve a summer pilot", { answer_to: decision.request_id });
  const approval = pending()!;
  expect(approval.kind).toBe("approval");
  expect(interview_workspace(session, db).context?.entities).toMatchObject({ subject: "me", audience: "बोर्ड", decision: "Approve a summer pilot" });
  await send("Proceed with everything you want");
  expect(jobs).toEqual([]);
  const request = input("Start researching", { answer_to: approval.request_id, option_id: "approve" });
  const accepted = await run_studio_turn(db, session, request, services);
  expect(accepted.activity?.tool).toBe("queue_research");
  expect(await run_studio_turn(db, session, request, services)).toEqual(accepted);
  expect(jobs).toHaveLength(1);
  expect(pending()).toBeNull();
  await send("How far along are you?");
  await send("Make a deck about me.");
  expect(interview_workspace(session, db).job?.job_id).toBe(jobs[0]);
  expect(interview_workspace(session, db).brief?.brief_id).toBe(approval.brief_id!);
  const history = interview_workspace(session, db);
  expect(history.activities.find(item => item.turn_id === audience.turn_id)?.question?.options).toEqual(audience.options);
  expect(history.history.find(item => item.turn_id === request.turn_id)).toMatchObject({ answer_to: approval.request_id, option_id: "approve" });
});

test("spoken addresses need confirmation, and source corrections preserve the subject and never enqueue research", async () => {
  const { db, session, jobs, send, pending } = studio();
  await send("Make a deck about me.");
  await send("Use dk-ai.in", { input: "speech" });
  const guessed = pending()!;
  expect(guessed.kind).toBe("source_url");
  expect(interview_workspace(session, db).context?.entities.urls).toEqual([]);
  await send("It is JK-IFNA.", { input: "speech" });
  expect(interview_workspace(session, db).context?.entities.subject).toBe("me");
  await send("No, the source is jk-ai.in", { answer_to: guessed.request_id });
  const recovered = interview_workspace(session, db);
  expect(recovered.context?.entities).toMatchObject({ subject: "me", urls: ["https://jk-ai.in/"] });
  expect(recovered.context?.pending).toBeNull();
  await send("Use jk-ai.in", { input: "speech" });
  const confirm = pending()!;
  await expect(Promise.resolve().then(() => db.studio.acknowledge_question(session, confirm.request_id, confirm.turn_id))).rejects.toThrow("not offered");
  await send("Yes, confirm this URL.", { input: "speech" });
  expect(interview_workspace(session, db).context?.pending?.url).toBe("https://jk-ai.in/");
  db.studio.offer_question(session, confirm.turn_id);
  db.studio.acknowledge_question(session, confirm.request_id, confirm.turn_id);
  await send("Yes, confirm this URL.", { input: "speech" });
  expect(interview_workspace(session, db).context?.pending).toBeNull();
  await send("Use other-site.in", { input: "speech" });
  const discard = pending()!;
  db.studio.offer_question(session, discard.turn_id);
  db.studio.acknowledge_question(session, discard.request_id, discard.turn_id);
  await send("No.", { input: "speech" });
  expect(interview_workspace(session, db).context?.entities.urls).toEqual(["https://jk-ai.in/"]);
  expect(jobs).toEqual([]);
});

test("file replies use only project-scoped verified excerpts and their source locators", async () => {
  const { db, session, send } = studio();
  for (const kind of ["pdf", "pptx", "csv"] as const) {
    const source_id = crypto.randomUUID();
    const filename = "Pilot." + kind;
    db.sources.save(session, kind, { source_id, kind, filename, locations: 1, records: [{ number: 2, text: "Pilot includes 24 buyers." }], gaps: [] });
    const question = { pdf: "Could you read the PDF?", pptx: "What does the PowerPoint say about the pilot? Cite the slide.", csv: "What does the CSV say?" }[kind];
    const result = await send(question, { source_ids: [source_id] });
    expect(result.text).toContain(filename);
    expect(result.activity?.citations?.[0]).toMatchObject({ excerpt: "Pilot includes 24 buyers." });
  }
  expect((await send("Does any file confirm a moon mission?")).text).toContain("couldn't find");
  const foreign = crypto.randomUUID();
  db.sources.save("another-project", "pdf", { source_id: foreign, filename: "Private.pdf", kind: "pdf", locations: 1, records: [], gaps: [] });
  await expect(send("Could you read the PDF?", { source_ids: [foreign] })).rejects.toThrow("Unknown research source");
});
