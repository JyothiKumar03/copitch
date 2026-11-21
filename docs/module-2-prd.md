# Module 2 PRD · Live presentation from an approved pitch

Status: implementation reference · Date: 2026-11-21
Read this with the [HTML presentation plan](module-2-html-presentation.md), which specifies review authority and the paint gate for accepting and advancing after a live edit.

## 1. Problem and outcome

The host finishes Module 1 with a researched `context.md` with verified findings and citations. Module 2 turns that into a deck and lets an agent present it to a live audience by voice. The agent narrates slide by slide, stops the moment someone speaks, answers questions from the evidence, proposes slide changes only with the host's approval, and resumes exactly where it stopped.

**Done means:** a host opens a saved pitch, reviews a deck and its narration, presses Present, and the audience sees the slides on a second screen and hears them narrated. A question mid-sentence gets a cited answer and the talk resumes at the interrupted sentence. A spoken correction becomes a reviewed before/after change that only the host can apply. Anyone can open the HTML, PDF or PPTX export afterwards.

## 2. Users and surfaces

| Surface | Who | Sees | Can do |
|---|---|---|---|
| Host console | Host (signed in, owns the project) | Slides, private narration, Q&A with sources, pending changes, controls | Approve the deck, present, pause, resume, next, back, skip, approve or reject a change, export |
| Audience stage | Audience (link with a scoped token, read-only) | The current approved slide only | Nothing; it reports what it painted |
| Voice | Host and room microphone | — | Ask questions, request changes, give commands |

Private narration, research traces, pending changes and the host conversation never reach the audience stage or exports.

## 3. Inputs (dependency on Module 1)

The deck is only as good as the brief. Module 2 consumes the verified research bundle from an approved brief:

- `findings.sections`: the cited brief (who or what, education or background, journey, projects, numbers, how they work, what's next).
- `pitch_script`: optional verified narration from legacy bundles. For new context bundles, the planner builds narration from verified findings and evidence.
- `evidence[]`: the records (`P*`, `H*`, `M*`) with location and URL.
- `intent`: subject, audience, outcome, deliverable from the approved plan.

**Dependency** — Module 1 runs goal-directed discovery through `SessionRunner` and saves verified findings, evidence and the standalone context document in the research bundle. Module 2 consumes the approved saved revision. It can use bundles created before the research agent was introduced.

## 4. Reference analysis: `../live-slides`

`live-slides` (pnpm monorepo, Express + `ws`, Next.js 15, JSON or Postgres storage) presents an approved script: it plans "beats" (narration + one slide each), narrates them with TTS, answers questions and accepts live amendments. Its model paths (planning, Q&A, amendments, TTS) were not exercised in that checkout because the API key was disabled; only its offline fallbacks are verified by its 82 tests.

**Adopt**

| What | Where in live-slides | Why |
|---|---|---|
| Beat = narration + one slide, planned fully before narration starts | `packages/shared/src/agent.ts:17-22`, `architecture.md:20-31` | Simple, checkpointable unit; deck exists before the talk |
| Slide schema with 12 layouts and bounded fields (title ≤72, ≤4 bullets ≤110, metrics, quote, timeline, chart ≤3 series × 8 points, comparison) | `packages/shared/src/slide.ts:3-16, 54-70` | Our deck has 3 layouts; this covers people, metrics, timelines and comparisons |
| Planner rules: preserve every material claim and number, never add facts, 35–90 spoken words per beat, 1–4 scan-friendly bullets, chart values only when stated | `apps/server/prompts/script-planner.md` | Matches our grounding stance; becomes a prompt in `prompts.ts` |
| Spoken-number normalisation and evidence detectors (quote, comparison, timeline, metrics) | `apps/server/src/services/slide-evidence.ts:44,151,197,219,259,269` | Deterministic layout choice and a fallback planner |
| `narrationDone` accepted only for the registered message ID; pending speech registered before broadcast | `presenter-agent-service.ts:518-535, 903-923` | Stale playback callbacks cannot advance the talk |
| Deck saved before narration; one shared export history | `presenter-agent-service.ts:133-136`, `features/deck-export.md:63-72` | Export is available at any time |
| Exporters: self-contained HTML with inline SVG charts, PPTX with native charts and narration as notes, vector PDF, sharing one theme and grid | `apps/server/src/services/export/*`, `packages/shared/src/deck-theme.ts` | No headless browser or network needed |

**Do not adopt (gaps this PRD closes)**

| Gap in live-slides | Evidence | Requirement here |
|---|---|---|
| A spoken question during narration is routed to "listening for amendment", not answered | `presenter-agent-service.ts:235-270` | R4.2: every utterance is classified before it is acted on |
| Answers carry no sources; grounding is prompt-only | `presenter-agent-service.ts:659-700` | R4.3: answers cite evidence and are checked |
| Model-planned chart numbers are never checked against the script | `script-planner-service.ts:65-83` | R1.4: every number on a slide must appear in an evidence record |
| Resume replays the whole beat | `presenter-agent-service.ts:186-200, 526-533` | R3.3: resume at the interrupted sentence |
| Pending speech, confirmations and edit holds live in memory; handlers race on read-modify-write | `presenter-agent-service.ts:54-88`, `websocket-service.ts:95` | R5.1–R5.2: per-session serial commands, persisted pending state |
| Broadcast to every client; one process-global deck; no auth | `websocket-service.ts:83-88`, `TODO.md:33-43` | R5.3: per-session channels, scoped audience token |
| No audience view; local navigation does not move the agent | `page.tsx`, `TODO.md:17-18` | R2.2, R3.4 |
| Approving an amendment appends the instruction text to the narration | `presenter-agent-service.ts:487-497` | R4.5: a change is a typed patch to fields, never raw instruction text |
| Thresholds for barge-in tuned on nothing; no evals | `PROGRESS.md:274-276` | R6: measured rehearsal and model evals |

**What copitch already has** (reuse, do not rebuild): deck types and revisions (`backend/src/types/deck.ts`, `repositories/deck.ts`), deck compilation from findings (`services/deck.ts`), story planner with time budget (`services/pitch.ts`), live Q&A and edit turn (`services/live-turn.ts`), the continuation reducer with attempts, paint and skip/revisit (`services/continuation.ts`, `types/continuation.ts`), the audience projection with a token (`controllers/audience.ts`, `frontend/components/deck/AudienceStage.tsx`), HTML export (`frontend/lib/export-deck.ts`), and the Live voice session from Module 1 (`services/live-session.ts`, `live-interviewer.ts`).

## 5. Requirements

### R1 · Deck planning

- **R1.1** The host starts from a saved, approved pitch revision. The planner receives the brief sections, talk track, evidence, intent, audience, time budget and optional slide count.
- **R1.2** The planner returns beats. Each beat has narration split into sentences, one slide, the evidence IDs it uses, and an estimated speaking time (135 words per minute + 3 s per slide, as in `services/pitch.ts`).
- **R1.3** Slides use the adopted layout set: TitleCard, BulletSlide, MetricGrid, Timeline, Quote, Comparison, BarChart, LineChart, DonutChart. Image layouts are out of scope until an image source exists.
- **R1.4** Every visible fact cites evidence. Every number, date and name on a slide must appear in a cited record, using the shared `quotes()` comparison (`services/excerpt.ts`); charts additionally require each plotted value to be stated. Failing beats are dropped or re-planned, never published.
- **R1.5** For a person: title card, who they are, education, journey (timeline), key projects with numbers (metrics), how they work, what's next or the ask. For a company or product: problem, product, proof points, team, ask. The plan follows the talk track order.
- **R1.6** The planner prompt lives in `backend/src/services/prompts.ts` with role, goal, outcome, methodology and guardrails.
- **R1.7** The host reviews the deck: slide preview, private narration per beat, total time against budget, and sources per slide. Approving saves a deck revision; only an approved revision can be presented.

### R2 · Rendering and export

- **R2.1** One public view model per slide feeds the host preview, the audience stage and every export, so they show the same words and numbers for the same revision.
- **R2.2** The audience stage is a separate page opened with a scoped token. It renders only the current approved slide, reports a paint acknowledgement (`continuation` `paint` action) and never receives narration or pending changes.
- **R2.3** Export to HTML (existing), PPTX with narration as speaker notes, and PDF, ported from `live-slides` exporters. Exports need no headless browser or network and contain no private data.
- **R2.4** Layout checks: no text overflow at 1280×720 or on a phone; overflow sends the beat back to the planner to shorten or split.

### R3 · Narration and playback

- **R3.1** Narration is spoken word for word, as approved. Each sentence is synthesised once per text, language and voice and cached.
- **R3.2** The controller schedules one sentence at a time with an attempt ID. The host player reports start, natural end and interruption for that attempt; stale attempts are ignored (the `continuation` reducer's existing rule).
- **R3.3** The checkpoint is `{deck_revision, beat_id, sentence_index}`. Resume restarts the interrupted sentence, not the beat.
- **R3.4** Pause, resume, next, back, skip and go-to-slide move the controller's cursor. The audience stage follows the controller, not the host's local preview.
- **R3.5** The audience slide advances only after the next beat's slide is painted on the stage; narration for that beat starts after the paint acknowledgement.

### R4 · Interruption, questions and changes

- **R4.1** When anyone speaks, narration stops at once and the current sentence is marked unfinished. The approved slide stays on the stage.
- **R4.2** Each finished utterance is classified once: question, change request, navigation command, approval or rejection of a pending change, backchannel or noise. Classification sees the current slide, its narration, the pending change if any and the utterance. Ambiguous references ("that number") get one clarifying question.
- **R4.3** A question is answered from the deck, its evidence and permitted calculations. The answer cites evidence IDs with verbatim excerpts, checked with `quotes()`. When the evidence does not cover it, the agent says so and offers a scoped lookup. After the answer the talk resumes at the checkpoint.
- **R4.4** A change request produces a typed patch against the current slide (title, bullets, metrics, chart data, narration) at a base revision, with source or host attribution. The host sees before and after; the audience does not.
- **R4.5** Apply commits the patch once (proposal ID, deck ID, slide ID, base revision, idempotency key), publishes the updated slide, waits for paint, speaks any added sentence, then continues. Reject leaves the revision and cursor unchanged. A stale base requires a fresh proposal. Instruction text never becomes narration.
- **R4.6** A model reply, an audience question, silence or a playback callback cannot edit the deck or advance the cursor.

### R5 · Reliability, privacy and recovery

- **R5.1** Commands for one session are applied one at a time in arrival order, each against the current revision and cursor.
- **R5.2** Cursor, pending proposal, pending speech attempt and stage epoch are persisted. A restart or reconnect restores the session paused at the checkpoint with the pending review intact.
- **R5.3** Events go only to the session's own host and audience channels. The audience token is scoped to one deck and expires.
- **R5.4** Every model call has a recorded model, usage and outcome (as `ai-sdk.ts` already records).

### R6 · Measurement

- **R6.1** Live model paths are verified with a working key before release: planning, Q&A, change proposals and speech.
- **R6.2** Rehearsal on the event laptop records speech onset to audible stop, end of question to first answer audio, and paint latency.
- **R6.3** Evals with real pitches (including Jyothi Kumar's from jk-ai.in): fact coverage of the deck against the brief, zero unsupported numbers, question routing accuracy on a labelled set, answer citation validity.

## 6. Data model

```
TPresentation    { deck_id, research_id, revision, status: draft | approved, intent, beats[] }
TBeat            { beat_id, order, slide: TSlideV2, sentences: TSentence[], evidence_ids[], estimated_seconds }
TSentence        { sentence_id, text, evidence_ids[] }
TSlideV2         { slide_id, layout, title, bullets[], metrics?, quote?, timeline?, chart?, comparison?, evidence_ids[] }
TLiveSession     { session_id, deck_id, deck_revision, state, cursor: { beat_id, sentence_index }, generation, stage_epoch }
TAttempt         { attempt_id, beat_id, sentence_index, status: playing | finished | interrupted }
TChangeProposal  { proposal_id, slide_id, base_revision, before, after, attribution: evidence | host, status }
TQuestionAnswer  { turn_id, question, answer, citations: { evidence_id, excerpt }[], resumed_at }
```

`TSlideV2` extends the existing `TSlide` (`backend/src/types/deck.ts`) with the adopted layouts; existing decks map `headline → TitleCard`, `evidence → BulletSlide`, `takeaway → BulletSlide` with the existing `chart` mapped to `BarChart`.

## 7. Live session states

| State | Entered by | Leaves on |
|---|---|---|
| ready | Approved deck opened | Present → narrating |
| narrating | Present, Resume, answer finished, change applied | Speech onset → listening; last sentence of last beat → completed; Pause → paused |
| listening | Speech onset | Utterance classified → answering, proposing, the command's target, or back to narrating for backchannel |
| answering | Question | Answer finished → narrating at the checkpoint (or paused if it was paused) |
| proposing | Change request | Proposal ready → awaiting_decision; ambiguous → listening after one clarifying question |
| awaiting_decision | Proposal shown to host | Apply → applying; Reject → paused; new change → proposing (replaces) |
| applying | Apply | Paint acknowledged → narrating; stage disconnected → held until it returns |
| paused | Pause, Reject, reconnect | Resume → narrating; Next/Back/Go-to → narrating at the new beat |
| completed | Last sentence finished | Questions still answered; Restart → ready |

## 8. Acceptance

| ID | Check | Evidence |
|---|---|---|
| M2-1 | Plan the jk-ai.in pitch for two audiences (new team, hiring manager) | Different emphasis and layouts; every number on every slide found in a cited record; time within budget |
| M2-2 | Host preview, audience stage on a second device, HTML, PPTX and PDF of one revision | Same words and numbers on all five; no narration or pending change on the stage or in exports; no overflow at 1280×720 or on a phone |
| M2-3 | Ask "where did he study?" mid-sentence | Narration stops; answer cites the KMIT record; the talk resumes at the interrupted sentence |
| M2-4 | Say "add that he processed 30k+ calls" on the projects slide | One proposal with before/after and its source; stage unchanged until Apply; after Apply the stage paints, the new sentence is spoken, then the talk continues; a repeated Apply creates no second revision |
| M2-5 | Reject a proposal, say "go back to education", disconnect the stage | Revision unchanged; cursor moves to the education beat; reconnect restores the last approved slide, paused, with any pending review intact |
| M2-6 | Labelled utterance set (questions, change requests, commands, backchannels in English, Telugu and Hindi) | Routing accuracy measured and recorded; no backchannel triggers a change |
| M2-7 | Event laptop rehearsal | Onset-to-stop and question-to-answer latencies recorded with hardware and network noted |

## 9. Build order

1. **Deck v2 and planner** (R1, R2.1, R2.4): `TSlideV2`, planner prompt, number check, review screen. Verified by M2-1.
2. **Shared renderer and exports** (R2): public view model, audience stage parity, PPTX and PDF ported from live-slides. Verified by M2-2.
3. **Narration runtime** (R3, R5): sentence attempts on the existing continuation reducer, persisted cursor, serial commands, paint-gated advance. Verified by M2-5 (navigation and reconnect parts).
4. **Interruption, Q&A and changes** (R4): utterance routing, cited answers, typed patches with review. Verified by M2-3, M2-4, M2-6.
5. **Rehearsal and evals** (R6). Verified by M2-7.

## 10. Owner decisions

1. **Who speaks the narration.** Recommendation: sentence-level TTS (`gpt-4o-mini-tts`, voice `marin` or `cedar`) for approved narration, because it is word-for-word, cacheable and checkpointable per sentence; the Live session (`gpt-live-1.1`) listens to the room and speaks answers. Alternative: the Live model reads the narration itself, which is simpler but cannot guarantee exact wording or sentence checkpoints.
2. **How utterances are classified.** Recommendation: the Decisions API (`gpt-6-luna`), which returned calibrated probabilities in 0.1–0.9 s in the Module 1 test, with a threshold per class; below threshold the agent asks one clarifying question.
3. **Export formats for the first release:** HTML only, or HTML + PPTX + PDF.
4. **Audience link lifetime** and whether the audience can see slide sources.

## 11. Out of scope

Image generation, per-slide styling, multi-presenter sessions, audience-side questions from their own devices, and Module 3 browser walkthroughs.
