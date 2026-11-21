import { createHash } from "node:crypto";
import { DEFAULT_LANGUAGE, LANGUAGE_OPTIONS } from "../../../shared/languages";
import type { TInterviewLanguage } from "../../../shared/languages";
import { AppError } from "../errors/app-error";
import { source_summary } from "../repositories/source";
import type { SessionStore } from "../repositories/session";
import type { TResearchBrief } from "../types/research";
import { spoken_text_limit, url_selection_limit } from "../types/studio-turn";
import type { TStudioActivity, TStudioAsk, TStudioAskKind, TStudioContext, TStudioIntent, TStudioTurn, TStudioTurnInput } from "../types/studio-turn";
import { interview_workspace, progress_reply } from "./interview";
import { public_url } from "./research";
import { source_evidence } from "./source";
import type { TStudioIntentProvider, TStudioProposal } from "./studio-intent";

const phrases = {
  en: {
    greeting: "Hi! What are you pitching, and who will be listening?", language: "I'll reply in English.",
    meta: "I can help plan your pitch, read your selected files, and run the research you approve.",
    subject: "What is the pitch about?", audience: "Who will be listening to the pitch?", decision: "What should they decide or do after hearing it?",
    unready: "Let's finish reviewing the subject, audience, and decision before starting research.",
    approved: "I’m researching the scope you approved.", active: "I'll keep your approved research running. Use Change research scope to replace it.",
    no_job: "There’s no research job for this scope yet.", no_files: "Select the file you want me to read first.",
    no_answer: "I couldn't find an answer to that in the selected file records.", unavailable: "I couldn’t interpret that turn. Tell me what you’d like me to change or research.",
    unsupported: "I can help with the pitch, its sources, or its research status. This request is outside the studio.",
    convert: "Convert the old .ppt file to .pptx and upload it again so I can read its slides.",
    url: "Is this the source address you meant: ", type_url: "Type the exact source address or confirm the displayed address.",
    prefix: "Pitch", to: "Audience", ask: "Requested decision", ready: "Review this scope, then approve it when you're ready.",
    read: "Read selected file records", queue: "Research queued for the approved revision",
    excerpt: "From the selected files:", file_error: "I read the selected records, but the answer check was unavailable."
  },
  hi: {
    greeting: "नमस्ते! आप किस विषय पर पिच बना रहे हैं और श्रोता कौन होंगे?", language: "मैं हिंदी में जवाब दूँगा।",
    meta: "मैं आपकी पिच की योजना बना सकता हूँ, चुनी हुई फ़ाइलें पढ़ सकता हूँ और आपकी अनुमति से शोध कर सकता हूँ।",
    subject: "पिच किस बारे में है?", audience: "पिच के श्रोता कौन होंगे?", decision: "पिच सुनकर उन्हें क्या तय करना या करना चाहिए?",
    unready: "शोध शुरू करने से पहले विषय, श्रोता और वांछित निर्णय तय कर लें।",
    approved: "मैं आपके स्वीकृत दायरे पर शोध कर रहा हूँ।", active: "स्वीकृत शोध चलता रहेगा। उसे बदलने के लिए शोध का दायरा बदलें।",
    no_job: "इस दायरे के लिए अभी कोई शोध शुरू नहीं हुआ है।", no_files: "पहले वह फ़ाइल चुनें जिसे आप पढ़वाना चाहते हैं।",
    no_answer: "चुनी हुई फ़ाइलों में मुझे इस प्रश्न का उत्तर नहीं मिला।", unavailable: "मैं यह बात समझ नहीं पाया। बताइए कि आप क्या बदलना चाहते हैं या किस विषय पर शोध चाहिए।",
    unsupported: "मैं पिच, उसके स्रोतों और शोध की स्थिति में मदद कर सकता हूँ। यह अनुरोध इस स्टूडियो के दायरे से बाहर है।",
    convert: "पुरानी .ppt फ़ाइल को .pptx में बदलकर फिर अपलोड करें, ताकि मैं स्लाइड पढ़ सकूँ।",
    url: "क्या आपका मतलब इस स्रोत के पते से था: ", type_url: "सही स्रोत पता टाइप करें या दिखाए गए पते की पुष्टि करें।",
    prefix: "पिच", to: "श्रोता", ask: "वांछित निर्णय", ready: "दायरा देखें और तैयार होने पर शोध की अनुमति दें।",
    read: "चुनी हुई फ़ाइलों की सामग्री पढ़ी", queue: "स्वीकृत दायरे का शोध कतार में है",
    excerpt: "चुनी हुई फ़ाइलों से:", file_error: "मैंने चुनी हुई फ़ाइलों की सामग्री पढ़ी, लेकिन उत्तर की जाँच उपलब्ध नहीं थी।"
  },
} satisfies Record<TInterviewLanguage, Record<string, string>>;

const question_options = {
  en: {
    subject: [], audience: [{ id: "board", label: "Board" }, { id: "buyers", label: "Potential buyers" }, { id: "team", label: "My team" }],
    decision: [{ id: "pilot", label: "Approve a pilot" }, { id: "rollout", label: "Approve a rollout" }, { id: "next_steps", label: "Choose next steps" }],
    source_url: [{ id: "confirm", label: "Confirm this address" }, { id: "correct", label: "Enter a correction" }, { id: "discard", label: "Leave out this address" }],
    reference: [{ id: "source", label: "It's the source address" }, { id: "subject", label: "It's the pitch subject" }],
    approval: [{ id: "approve", label: "Start researching" }, { id: "keep_editing", label: "Keep editing" }],
  },
  hi: {
    subject: [], audience: [{ id: "board", label: "बोर्ड" }, { id: "buyers", label: "संभावित खरीदार" }, { id: "team", label: "मेरी टीम" }],
    decision: [{ id: "pilot", label: "पायलट मंज़ूर करें" }, { id: "rollout", label: "रोलआउट मंज़ूर करें" }, { id: "next_steps", label: "अगले कदम तय करें" }],
    source_url: [{ id: "confirm", label: "इस पते की पुष्टि करें" }, { id: "correct", label: "सही पता दर्ज करें" }, { id: "discard", label: "यह पता छोड़ें" }],
    reference: [{ id: "source", label: "यह स्रोत का पता है" }, { id: "subject", label: "यह पिच का विषय है" }],
    approval: [{ id: "approve", label: "शोध शुरू करें" }, { id: "keep_editing", label: "दायरा बदलें" }],
  },
} satisfies Record<TInterviewLanguage, Record<TStudioAskKind, TStudioAsk["options"]>>;

const language_request = (text: string): TInterviewLanguage | undefined => {
  const request = text.replace(/^from now on[, ]+/iu, "").replace(/ from now on(?=[.!।]?\s*$)/iu, "");
  if (/^(?:(?:ok(?:ay)?[, ]+|please )?(?:(?:just )?(?:speak|reply|answer|respond|continue|switch)(?: in| to)? )?(?:in )?english(?: please)?)[.!।]?$/iu.test(request)) return "en";
  if (/^(?:(?:ok(?:ay)?[, ]+|please )?(?:(?:just )?(?:speak|reply|answer|respond|continue|switch)(?: in| to)? )?(?:in )?hindi(?: please)?|hindi (?:mein|me) (?:jawab do|bolo|baat karo)|हि[ंन्]दी(?: में (?:बोलो|बोलें|बात करो|जवाब दो|जवाब दें))?)[.!।]?$/iu.test(request)) return "hi";
};

const affirmative = /^(?:yes|yeah|हाँ|हां|haan|han|जी|ji|correct|that's right|सही है)[.!।]?$/iu;
const confirm_source = /^(?:yes[, ]+)?(?:confirm (?:this |the )?(?:url|address)|पते की पुष्टि करें)[.!।]?$/iu;
const approve_research = /^(?:yes[, ]+)?(?:please )?(?:start (?:the )?research(?:ing)?|go ahead(?: and start(?: the)? research)?|run (?:the )?research|approve (?:the )?research|research (?:this|it)|शोध शुरू कर(?:ो|ें| दीजिए)|shodh shuru karo|research shuru karo)[.!।]?$/iu;
const retry_research = /^(?:please )?(?:retry (?:the )?research|फिर से शोध शुरू करो)[.!।]?$/iu;
const file_only = /^(?:please )?(?:files only|only (?:use )?my (?:files|materials)|use only (?:(?:the )?(?:uploaded|attached) files|my (?:files|materials))|no (?:web|public) search)\b|^(?:केवल|सिर्फ) (?:मेरी )?(?:फ़ाइलें|फाइलें)/iu;
const public_search = /^(?:please )?(?:include public research|allow public search|use the web|search the web)[.!।]?$/iu;
const direct_status = /^(?:(?:what(?:'s| is) (?:the )?(?:research )?(?:status|progress))|(?:how (?:far along are you|is the research going))|(?:is (?:it|the pitch) ready(?: yet)?)|(?:प्रगति क्या है|शोध की स्थिति क्या है|कहाँ तक पहुँचा|हो गया))[?!.।]?$/iu;
const direct_file_question = (text: string) =>
  /^(?:what|which|who|how|where|tell me|show|read|cite|summari[sz]e|can you (?:read|summari[sz]e|check)|क्या|कौन|बताइए)\b/iu.test(text) &&
  /\b(?:pdf|powerpoint|pptx?|csv|slide|attached (?:file|deck|document)|uploaded (?:file|deck|document))\b/iu.test(text);
const explicit_scope = /\b(?:change|replace|update) (?:the )?(?:research )?scope\b/iu;

const latest_language = (text: string, proposed?: TInterviewLanguage): TInterviewLanguage => {
  if (/[\u0900-\u097f]/u.test(text) || /\b(?:hindi|mujhe|mera|meri|jawab|batao|haan|karo|aap)\b/iu.test(text)) return "hi";
  return proposed ?? DEFAULT_LANGUAGE;
};

const literal_url = (text: string) => {
  const candidate = /(?<![@\w])(?:https?:\/\/)?(?:[a-z\d](?:[a-z\d-]*[a-z\d])?\.)+[a-z]{2,}(?::\d+)?(?:\/[^\s<>()\[\]"']*)?/iu.exec(text)?.[0];
  if (!candidate || /\.(?:pdf|pptx?|csv|docx?|xlsx?|zip|png|jpe?g)$/iu.test(candidate)) return;
  return public_url(/^https?:/iu.test(candidate) ? candidate.replace(/[!?,.;]+$/u, "") : "https://" + candidate.replace(/[!?,.;]+$/u, ""));
};

const quoted = (text: string, value: string | null | undefined) => {
  const quote = value?.trim();
  return quote && quote.length <= 280 && text.toLowerCase().includes(quote.toLowerCase()) ? quote : undefined;
};

export const initial_studio_context = (brief?: TResearchBrief): TStudioContext => ({
  language_preference: null, entities: { subject: null, audience: null, decision: null, urls: brief?.urls ?? [], facts: [] },
  pending: null, source_policy: brief?.source_policy ?? "public_search", source_ids: brief?.sources?.map(source => source.source_id) ?? [],
  materials: brief?.materials ?? "", reviewable_brief_id: brief && !brief.question ? brief.brief_id : null,
});

const brief_for_context = (input: TStudioTurnInput, context: TStudioContext, language: TInterviewLanguage,
  sources: TResearchBrief["sources"], history: NonNullable<TResearchBrief["history"]>): TResearchBrief => {
  const wording = phrases[language];
  const { subject, audience, decision, facts, urls } = context.entities;
  const lines = [[wording.prefix, subject], [wording.to, audience], [wording.ask, decision]].flatMap(([label, text]) => text ? [`${label}: ${text}`] : []);
  const summary = lines.join(". ") || wording.subject;
  const question = context.pending ? wording.type_url : !subject ? wording.subject : !audience ? wording.audience : !decision ? wording.decision : null;
  const reply = [...new Set([summary, question ?? wording.ready])].join("\n\n");
  return {
    brief_id: crypto.randomUUID(), summary, question, messages: [...lines, ...facts],
    history: [...history, { role: "host", text: input.message }, { role: "assistant", text: reply }],
    source_policy: context.source_policy, materials: context.materials, sources, urls,
    public_queries: context.source_policy === "public_search" && !urls.length && subject ? [subject] : [],
  };
};

export type TStudioTurnServices = { provider: TStudioIntentProvider; ensure_research: () => void; wake: (job_id: string) => void };

export const run_studio_turn = async (db: SessionStore, session: string, input: TStudioTurnInput, services: TStudioTurnServices) => {
  const request_hash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  const replay = db.studio.replay(session, input.turn_id, request_hash);
  if (replay) return replay;
  const snapshot = db.studio.snapshot(session);
  const previous = db.current_brief(session);
  if (input.brief_id && input.brief_id !== previous?.brief_id) throw new AppError(409, "Brief revision is stale");
  const context = snapshot && snapshot.revision > 0 ? snapshot.context : initial_studio_context(previous);
  const open_question = context.ask ?? null;
  if (input.answer_to && (input.answer_to !== open_question?.request_id || open_question.brief_id !== (previous?.brief_id ?? null))) {
    throw new AppError(409, "This question is no longer open. Use the current question in the studio.");
  }
  const option = input.option_id ? open_question?.options.find(item => item.id === input.option_id) : undefined;
  if (input.option_id && !option) throw new AppError(400, "Choose one of the options offered for this question");
  const heard_target = input.input === "speech" && open_question && open_question.brief_id === (previous?.brief_id ?? null) &&
    (!input.heard_question_id || (input.heard_question_id === open_question.request_id && input.heard_turn_id === open_question.turn_id)) &&
    db.studio.heard_question(session, open_question) ? open_question : undefined;
  const answer_target = input.answer_to ? open_question : heard_target;
  let answered_question: string | undefined;
  const close_question = () => {
    answered_question = open_question?.request_id;
    context.ask = null;
  };
  const history = interview_workspace(session, db).history;
  const prior_history = snapshot && snapshot.revision > 0 ? snapshot.prior_history : history;
  const current_job = previous && db.research_jobs.for_brief(session, previous.brief_id);
  const active = current_job?.status === "running" || current_job?.status === "queued";
  const chosen = language_request(input.message);
  const explicit_approval = open_question?.kind === "approval" && option?.id === "approve";
  const consent = explicit_approval || affirmative.test(input.message) || approve_research.test(input.message) || retry_research.test(input.message);
  const url = option ? undefined : literal_url(input.message);
  const selected_policy = file_only.test(input.message) ? "files_only" : public_search.test(input.message) ? "public_search" : undefined;
  const is_meta = /^(?:what|which) language\b|^(?:तुम|आप) कौन सी भाषा/iu.test(input.message);
  const is_greeting = /^(?:hi|hey|hello|नमस्ते|नमस्कार)[!।.]?$/iu.test(input.message);
  const initial_intent = chosen ? "language" : is_meta ? "meta" : is_greeting ? "greeting" : explicit_approval ? "approval" : option ? "clarify" :
    confirm_source.test(input.message) ? "url_confirmation" : consent ? "approval" :
    selected_policy || input.replace_scope ? "scope" : direct_status.test(input.message) ? "status" : direct_file_question(input.message) ? "file_question" : undefined;
  const ids = [...new Set(input.source_ids ?? context.source_ids)];
  const files = db.sources.selected(session, ids);
  let proposal: TStudioProposal | undefined;
  if (!initial_intent || initial_intent === "scope") {
    try {
      proposal = await services.provider.propose({ message: input.message, context: { entities: context.entities, pending: context.pending },
        history: history.slice(-10).map(turn => ({ role: turn.role, text: turn.text.slice(0, 600) })), has_files: files.length > 0, active_job: active });
    } catch { /* A missing proposal cannot authorize a change. */ }
  }
  let intent: TStudioIntent = initial_intent ?? (url ? "scope" : proposal?.intent ?? "unsupported");
  const language = chosen ?? context.language_preference ?? latest_language(input.message, proposal?.language);
  const wording = phrases[language];
  const done = (text: string, next_brief?: TResearchBrief, activity?: TStudioActivity, start_job = false) => {
    const turn: TStudioTurn = { turn_id: input.turn_id, user_text: option?.label ?? input.message, text: text.slice(0, spoken_text_limit),
      intent, language, created_at: Date.now(), ...(activity && { activity }), ...(answered_question && { answer_to: answered_question }),
      ...(answered_question && option && { option_id: option.id }) };
    let job_id: string | undefined;
    const saved = db.studio.commit(session, snapshot?.revision ?? 0, context, prior_history, request_hash, turn, () => {
      if (db.current_brief(session)?.brief_id !== previous?.brief_id) throw new AppError(409, "Brief revision is stale");
      if (next_brief && !db.replace_brief(session, previous?.brief_id, next_brief)) throw new AppError(409, "Brief revision is stale");
      if (start_job && previous) job_id = db.research_jobs.enqueue(session, previous.brief_id, retry_research.test(input.message)).job_id;
    });
    if (job_id) services.wake(job_id);
    return saved;
  };
  const ask_for = (kind: TStudioAskKind, question: string, text = question, next_brief?: TResearchBrief) => {
    const options = question_options[language][kind].filter(option => kind !== "source_url" || !!context.pending || option.id === "discard");
    const ask: TStudioAsk = { request_id: crypto.randomUUID(), turn_id: input.turn_id, kind, question, options,
      allow_free_text: true, brief_id: next_brief?.brief_id ?? previous?.brief_id ?? null };
    context.ask = ask;
    return done(text, next_brief, { tool: "ask_input", status: "awaiting_input", result: question, question: ask });
  };
  if (!active) {
    context.source_ids = ids;
    context.source_policy = input.source_policy ?? context.source_policy;
    context.materials = input.materials ?? context.materials;
  }
  if (chosen) {
    context.language_preference = chosen;
    return done(wording.language);
  }
  if (intent === "greeting") return done(wording.greeting);
  if (intent === "meta") return done(is_meta ? LANGUAGE_OPTIONS[language].label : wording.meta);
  if (intent === "status") return done(current_job ? progress_reply(current_job, language) : wording.no_job);
  if (open_question && !answer_target && ((input.input === "speech" && consent) || affirmative.test(input.message) || confirm_source.test(input.message))) {
    return done(language === "hi" ? "जिस सवाल का जवाब देना है, उसे स्क्रीन पर चुनें या पूरा सवाल सुनें।" :
      "Choose the question on screen or listen to it before answering.");
  }
  if (open_question?.kind === "approval" && option?.id === "keep_editing") {
    close_question();
    return done(language === "hi" ? "बताइए कि आप दायरे में क्या बदलना चाहते हैं।" : "Tell me what you'd like to change in the scope.");
  }
  if (open_question?.kind === "reference" && option?.id === "source") {
    close_question();
    context.reference = undefined;
    return ask_for("source_url", wording.type_url);
  }
  if (open_question?.kind === "source_url" && option?.id === "correct") {
    close_question();
    return ask_for("source_url", wording.type_url);
  }
  if (/\.ppt\b/iu.test(input.message) && !files.some(file => file.kind === "ppt")) return done(wording.convert);
  if (intent === "file_question") {
    if (!files.length) return done(wording.no_files);
    const named = files.filter(file => input.message.toLowerCase().includes(file.filename.toLowerCase()));
    const words = new Set(input.message.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []);
    const evidence = (named.length ? named : files).flatMap(source_evidence).map(row => ({ row, rank: [...words].filter(word => row.passage.toLowerCase().includes(word)).length }))
      .sort((a, b) => b.rank - a.rank).slice(0, 18).map(({ row }) => ({ ...row, passage: row.passage.slice(0, 1400) }));
    const activity: TStudioActivity = { tool: "read_source", status: "completed", result: wording.read };
    let result: Awaited<ReturnType<TStudioIntentProvider["excerpts"]>>;
    try { result = await services.provider.excerpts(input.message, evidence, language); }
    catch { return done(wording.file_error, undefined, activity); }
    if (!result) return done(wording.file_error, undefined, activity);
    const citations = result.citations.slice(0, 3).flatMap(citation => {
      const row = evidence.find(item => item.id === citation.evidence_id);
      const quote = citation.excerpt.trim();
      return row && quote && quote.length <= 300 && row.passage.includes(quote) ? [{ evidence_id: row.id, location: row.location, excerpt: quote }] : [];
    });
    const quotes = citations.map(citation => `“${citation.excerpt}” (${citation.location})`);
    return done(quotes.length ? `${wording.excerpt}\n${[...new Set(quotes)].join("\n")}` : wording.no_answer, undefined, { ...activity, citations });
  }

  const spoken_phrase = quoted(input.message, proposal?.source_phrase);
  const proposed_url = spoken_phrase && /\bdot\b|डॉट|\./iu.test(spoken_phrase) && proposal?.source_url ? public_url(proposal.source_url) : undefined;
  const candidate_url = url ?? proposed_url;
  const pending = context.pending;
  const confirmed_pending = answer_target?.kind === "source_url" && (option?.id === "confirm" ||
    affirmative.test(input.message) || confirm_source.test(input.message));
  const discard_pending = answer_target?.kind === "source_url" && (option?.id === "discard" || /^(?:no|नहीं|nahi)[.!।]?$/iu.test(input.message));
  const replacing = input.replace_scope || explicit_scope.test(input.message) || selected_policy !== undefined;
  if (active && !replacing && (candidate_url || ["brief", "scope", "correction", "revision", "clarify"].includes(intent))) return done(wording.active);
  if (candidate_url && (input.input === "speech" || !url)) {
    intent = "url_confirmation";
    context.pending = { url: candidate_url, phrase: spoken_phrase ?? input.message };
    return ask_for("source_url", wording.url + candidate_url);
  }
  if (pending && !candidate_url && !confirmed_pending && !selected_policy && !discard_pending) {
    intent = "url_confirmation";
    return open_question?.kind === "source_url" ? done(wording.type_url) : ask_for("source_url", wording.type_url);
  }
  if (!candidate_url && !pending && context.entities.urls.length && /^(?:it is|it's|no,? (?:it|that) is)\b/iu.test(input.message) &&
      ["scope", "url_confirmation"].includes(history.at(-1)?.intent ?? "")) {
    intent = "url_confirmation";
    context.reference = input.message.replace(/^(?:it is|it's|no,? (?:it|that) is)\s*/iu, "").replace(/[.।]+$/u, "").slice(0, 280);
    return ask_for("reference", language === "hi" ? "क्या यह स्रोत का पता है या पिच का विषय?" : "Is that the source address or the pitch subject?");
  }
  if (!pending && !candidate_url && intent === "approval") {
    if (current_job && !retry_research.test(input.message)) return done(progress_reply(current_job, language));
    if (!consent || (input.input === "speech" || affirmative.test(input.message)) && answer_target?.kind !== "approval" ||
      !previous || input.brief_id !== previous.brief_id || previous.question || context.reviewable_brief_id !== previous.brief_id ||
      (input.source_ids && JSON.stringify(ids) !== JSON.stringify(previous.sources?.map(item => item.source_id) ?? [])) ||
      (input.source_policy && input.source_policy !== previous.source_policy) ||
      (input.urls && JSON.stringify(input.urls.map(public_url)) !== JSON.stringify(previous.urls)) ||
      (input.materials !== undefined && input.materials !== previous.materials)) return done(wording.unready);
    if (current_job && current_job.status !== "failed") return done(progress_reply(current_job, language));
    services.ensure_research();
    if (open_question?.kind === "approval") close_question();
    return done(wording.approved, undefined, { tool: "queue_research", status: "queued", result: wording.queue }, true);
  }
  const answers_field = answer_target && ["subject", "audience", "decision"].includes(answer_target.kind);
  if ((intent === "unsupported" || intent === "language" || intent === "url_confirmation") && !candidate_url &&
      !(pending && confirmed_pending) && !discard_pending && !answers_field) {
    return done(proposal ? wording.unsupported : wording.unavailable);
  }
  const confirmed_url = candidate_url ?? (confirmed_pending ? pending?.url : undefined);
  if (confirmed_url) {
    intent = pending ? "url_confirmation" : "scope";
    context.pending = null;
    if (open_question?.kind === "source_url" || open_question?.kind === "reference") close_question();
    const removal = /\b(?:remove|drop|don't use|do not use)\b/iu.test(input.message);
    const correction = /^(?:no|actually|correction)\b/iu.test(input.message) && context.entities.urls.length === 1;
    const previous_urls = correction && !removal ? [] : context.entities.urls.filter(value => value !== pending?.url && (!removal || value !== confirmed_url));
    context.entities.urls = [...new Set([...previous_urls, ...(removal ? [] : [confirmed_url])])].slice(-url_selection_limit);
  }
  if (!confirmed_url || (!pending && proposal?.intent === "brief")) {
    const subject = quoted(input.message, proposal?.subject);
    const audience = quoted(input.message, proposal?.audience);
    const decision = quoted(input.message, proposal?.decision);
    const fact = quoted(input.message, proposal?.fact);
    if (open_question?.kind === "reference" && option?.id === "subject" && context.reference) {
      context.entities.subject = context.reference;
      context.reference = undefined;
      close_question();
    }
    if (subject && !literal_url(subject)) context.entities.subject = subject;
    if (audience) context.entities.audience = audience;
    if (decision) context.entities.decision = decision;
    if (answers_field) {
      const field = answer_target.kind as "subject" | "audience" | "decision";
      const answer = option?.label ?? (input.answer_to && input.message.length <= 280 && intent !== "approval" ? input.message : undefined);
      if (answer) context.entities[field] = answer;
      if (context.entities[field]) close_question();
    }
    if (fact) context.entities.facts = [...new Set([...context.entities.facts, fact])].slice(-6);
  }
  context.source_policy = selected_policy ?? input.source_policy ?? context.source_policy;
  if (input.urls && !confirmed_url && input.input === "typed") {
    const explicit = input.urls.map(public_url);
    if (explicit.some(value => !value)) throw new AppError(400, "Use public HTTP or HTTPS source addresses");
    context.entities.urls = [...new Set([...(explicit as string[]), ...context.entities.urls])].slice(-url_selection_limit);
  }
  if (selected_policy === "files_only" || discard_pending) {
    context.pending = null;
    if (open_question?.kind === "source_url") close_question();
  }
  context.source_ids = ids;
  context.materials = input.materials ?? context.materials;
  const brief = brief_for_context(input, context, language, files.map(source_summary), history);
  context.reviewable_brief_id = brief.question ? null : brief.brief_id;
  const kind = context.pending ? "source_url" : !context.entities.subject ? "subject" : !context.entities.audience ? "audience" :
    !context.entities.decision ? "decision" : "approval";
  const question = brief.question ?? wording.ready;
  return ask_for(kind, question, [...new Set([brief.summary, question])].join("\n\n"), brief);
};
