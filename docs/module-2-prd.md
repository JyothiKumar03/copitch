# Module 2 PRD · Live presentation from an approved pitch

Status: implementation reference · Date: 2026-11-21
Read this with the [HTML presentation plan](module-2-html-presentation.md), which specifies review authority and the paint gate for accepting and advancing after a live edit.


The [current presentation flow and diagrams](presentation-flow.md) define preparation, visual review, and host-screen delivery.

## 1. Problem and outcome

The host approves a research scope and chooses a maximum slide count. The agent checks the saved evidence, plans the deck, and reviews a Playwright render before the host sees it.

**Done means** the host can review and approve a checked deck, start narration on the current screen, interrupt with a cited question, and resume at the same sentence. A slide correction stays in private review until approved. The deck can be opened offline as standalone HTML.

## 2. Host surfaces

| Surface | What the host can do |
|---|---|
| Deck review | Inspect slides, private narration, and evidence, then approve or export the HTML |
| Live presentation | Pause, resume, go next or back, skip, and privately apply or reject a change |
| Voice | Interrupt narration, ask a question, request a change, or give a navigation command |

Private narration, research traces, pending changes, and host conversation stay out of the HTML export.

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
| Beat = narration + one slide, planned fully before narration starts | `backend/src/types/deck.ts`, `backend/src/services/presentation-planner.ts` | The deck exists before the talk and each beat can be resumed |
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

**What copitch already has** (reuse, do not rebuild): deck types and revisions (`backend/src/types/deck.ts`, `repositories/deck.ts`), deck compilation from findings (`services/deck.ts`), story planner with time budget (`services/pitch.ts`), live Q&A and edit turn (`services/live-turn.ts`), the continuation reducer with attempts, paint and skip/revisit (`services/continuation.ts`, `types/continuation.ts`), the audience projection with a token (`controllers/audience.ts`, `frontend/components/deck/LiveDeck.tsx`), HTML export (`frontend/lib/export-deck.ts`), and the Live voice session from Module 1 (`services/live-session.ts`, `live-interviewer.ts`).

## 5. Requirements

### R1 · Deck planning

- **R1.1** The host starts from a saved, verified research revision and chooses a slide count. The planner receives the verified findings, linked evidence, available charts and the requested ceiling. Interview transcripts, prior scripts and instructions stay outside this content boundary.
- **R1.2** The planner returns beats. Each beat has narration split into sentences, one slide, the evidence IDs it uses, and an estimated speaking time (135 words per minute + 3 s per slide, as in `services/pitch.ts`).
- **R1.3** Slides use the adopted layout set: TitleCard, BulletSlide, MetricGrid, Timeline, Quote, Comparison, BarChart, LineChart, DonutChart. Image layouts are out of scope until an image source exists.
- **R1.4** Every visible fact cites evidence. Every number, date and name on a slide must appear in a cited record, using the shared `quotes()` comparison (`services/excerpt.ts`); charts additionally require each plotted value to be stated. Failing beats are dropped or re-planned, never published.
- **R1.5** Group the saved findings by what the subject and evidence support. Choose points, a chart, or both per slide. Use the full count when the material supports distinct beats.
- **R1.6** The planner prompt lives in `backend/src/services/prompts.ts` with role, goal, outcome, methodology and guardrails.
- **R1.7** The host reviews the slides, private narration, estimated speaking time and sources. Only an explicitly approved revision can be presented.

### R2 · Rendering and export

- **R2.1** One public view model feeds host review, the live stage, Playwright, and offline HTML. All surfaces show the same slide words and numbers.
- **R2.2** Present on the host's screen by default. The stage acknowledges the current approved slide paint before speech proceeds. Any existing separate stage uses a scoped token and receives the public slide only.
- **R2.3** The release format is standalone HTML with public slides and no private data. PPTX and PDF remain follow-up formats.
- **R2.4** Layout checks: no text overflow at 1280×720 or on a phone; overflow sends the beat back to the planner to shorten or split.

### R3 · Narration and playback

- **R3.1** Narration is spoken word for word, as approved. Each sentence is synthesised once per text, language and voice and cached.
- **R3.2** The controller schedules one sentence at a time with an attempt ID. The host player reports start, natural end and interruption for that attempt; stale attempts are ignored (the `continuation` reducer's existing rule).
- **R3.3** The checkpoint is `{deck_revision, beat_id, sentence_index}`. Resume restarts the interrupted sentence, not the beat.
- **R3.4** Pause, resume, next, back, and skip move the controller's cursor. The live stage follows the acknowledged cursor.
- **R3.5** Narration for the next beat starts after its stage paint acknowledgement.

### R4 · Interruption, questions and changes

- **R4.1** Approval can request microphone permission. With room capture enabled, speech onset stops the browser player and the current sentence is marked unfinished. The approved slide stays visible. The host can ask privately in text when the microphone is unavailable.
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
| M2-1 | Plan the same saved context at two slide limits | Group verified findings into each limit; verify chart values and slide copy against cited records |
| M2-2 | Host preview, same-screen live stage, and HTML export of one revision | Same words and numbers across surfaces. Confirm the public slide and export exclude private content and fit at 1280×720 and on a phone. |
| M2-3 | Ask "where did he study?" mid-sentence | Narration stops; answer cites the KMIT record; the talk resumes at the interrupted sentence |
| M2-4 | Say "add that he processed 30k+ calls" on the projects slide | One proposal with before/after and its source; stage unchanged until Apply; after Apply the stage paints, the new sentence is spoken, then the talk continues; a repeated Apply creates no second revision |
| M2-5 | Reject a proposal, say "go back to education", disconnect the stage | Revision unchanged; cursor moves to the education beat; reconnect restores the last approved slide, paused, with any pending review intact |
| M2-6 | Labelled utterance set (questions, change requests, commands, backchannels in English, Telugu and Hindi) | Routing accuracy measured and recorded; no backchannel triggers a change |
| M2-7 | Event laptop rehearsal | Onset-to-stop and question-to-answer latencies recorded with hardware and network noted |

## 9. Build order

1. **Deck v2 and planner** (R1, R2.1, R2.4): `TSlideV2`, planner prompt, number check, review screen. Verified by M2-1.
2. **Shared renderer and HTML export** (R2). Reuse the public slide projection across review, stage, and offline HTML. Verify with M2-2.
3. **Narration runtime** (R3, R5): sentence attempts on the existing continuation reducer, persisted cursor, serial commands, paint-gated advance. Verified by M2-5 (navigation and reconnect parts).
4. **Interruption, Q&A and changes** (R4): utterance routing, cited answers, typed patches with review. Verified by M2-3, M2-4, M2-6.
5. **Rehearsal and evals** (R6). Verified by M2-7.

## 10. Runtime choices and follow-ups

1. Module 2 uses browser capture and speech onset, the private Python adapter for STT and sentence TTS, and a purpose-scoped OpenAI text model for proposals. Express validates each proposal against the pinned slide and evidence.
2. Hosted rehearsal and additional export formats remain follow-ups. The release flow uses the host screen and standalone HTML.

## 11. Out of scope

Image generation, per-slide styling, multi-presenter sessions, audience-side questions from their own devices, and Module 3 browser walkthroughs.
