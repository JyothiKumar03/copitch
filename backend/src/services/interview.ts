import { brief_history } from "./research-history";
import { database } from "../repositories/store";
import { source_summary } from "../repositories/source";
import type { SessionStore } from "../repositories/session";
import { spoken_text_limit } from "../types/studio-turn";
import type { TInterviewBrief, TInterviewWorkspace } from "../types/interview";
import type { TResearchBrief } from "../types/research";

import type { TResearchJob } from "../types/research-job";

export const progress_reply = (job: TResearchJob, language: "en" | "hi") => {
  const messages = {
    en: { queued: "Your research is queued.", running: "Research is running.", completed: "Your pitch is ready to open.", failed: "Research stopped. You can retry from the studio.", superseded: "A newer brief replaced this research." },
    hi: { queued: "आपका शोध कतार में है।", running: "शोध जारी है।", completed: "आपकी पिच तैयार है।", failed: "शोध रुक गया है। आप फिर कोशिश कर सकते हैं।", superseded: "शोध का विषय बदल गया है।" },
  };
  const progress = messages[language][job.status];
  if (job.status !== "running") return progress;
  return language === "hi" ? `${progress} अब तक खोज के ${job.completed_lookups} प्रयास हुए हैं।` : `${progress} Lookup attempts processed: ${job.completed_lookups}.`;
};

export const interview_greeting = "What are you pitching, and who will be listening?";
export const max_spoken_length = spoken_text_limit;

export const spoken_prompt = (brief: TResearchBrief): string => {
  if (brief.question) {
    return brief.question.length <= max_spoken_length
      ? brief.question
      : "Please review the full follow-up question on screen and tell me your answer.";
  }
  const hindi = /[\u0900-\u097f]/u.test(brief.summary);
  const readback = hindi ? `${brief.summary} क्या मैं शोध शुरू करूँ?` : `Here is the research scope. ${brief.summary} Shall I start researching?`;
  return readback.length <= max_spoken_length
    ? readback
    : hindi ? "कृपया स्क्रीन पर शोध का दायरा देखें। क्या मैं शोध शुरू करूँ?" : "I’ve put the full research scope on screen for you to review. Shall I start researching?";
};

const studio_history = (brief: TResearchBrief, session?: string, db = database()) => {
  const turns = brief_history(brief);
  if (!session) return turns;
  const restored = [...turns];
  let offset = 0;
  for (const entry of db.research_jobs.progress_turns(session)) {
    restored.splice(Math.min(turns.length, entry.after_turn) + offset, 0,
      { role: "host", text: entry.question }, { role: "assistant", text: entry.answer });
    offset += 2;
  }
  return restored;
};

export const interview_brief = (brief: TResearchBrief, session?: string, db?: SessionStore): TInterviewBrief => ({
  brief_id: brief.brief_id,
  summary: brief.summary,
  question: brief.question,
  public_queries: brief.public_queries,
  spoken_prompt: spoken_prompt(brief),
  history: studio_history(brief, session, db),
  sources: brief.sources ?? [],
});

export const interview_workspace = (session: string, db = database()): TInterviewWorkspace => {
  const brief = db.current_brief(session);
  const capabilities = { source_uploads: true };
  const snapshot = db.studio.snapshot(session);
  const turns = snapshot ? db.studio.turns(session) : [];
  const history = snapshot && turns.length ? [...snapshot.prior_history, ...turns.flatMap(turn => {
    const identity = { turn_id: turn.turn_id, created_at: turn.created_at, intent: turn.intent, answer_to: turn.answer_to, option_id: turn.option_id };
    return [{ role: "host" as const, text: turn.user_text, ...identity }, { role: "assistant" as const, text: turn.text, ...identity }];
  })] : brief ? studio_history(brief, session, db) : snapshot?.prior_history ?? [];
  const conversation = {
    history, sources: snapshot ? db.sources.selected(session, snapshot.context.source_ids).map(source_summary) : brief?.sources ?? [],
    activities: turns.flatMap(turn => turn.activity ? [{ turn_id: turn.turn_id, ...turn.activity }] : []),
    pending_question: snapshot?.context.ask ?? null,
    ...(snapshot && { context: snapshot.context }),
  };
  if (!brief) return { ...conversation, capabilities, job: null, brief: null, research: null };
  const bundle = db.research_by_brief(session, brief.brief_id);
  return {
    ...conversation, capabilities,
    artifacts: db.earlier_artifacts(session, brief.brief_id),
    job: db.research_jobs.for_brief(session,brief.brief_id) ?? null,
    brief: { ...interview_brief(brief, session, db), history, materials: brief.materials, urls: brief.urls, source_policy: brief.source_policy },
    research: bundle ? { research_id: bundle.research_id, markdown: bundle.markdown, gaps: bundle.gaps } : null,
  };
};
