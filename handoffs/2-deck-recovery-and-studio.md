# Handoff: Deck recovery and SaaS studio (module 2)

Contract: handoffs/2-deck-recovery-and-studio.contract.md
Commit/base: Exact-count recovery `fd76927`, studio `5fd1d39`, live review `56e8d4e`, caption timing `fac001e`, objective coverage `ffc65d6`, and the deck recovery and studio integration in the working tree from `ff56d35`.
Files changed: `frontend/app/globals.css`, `frontend/components/{home,projects,research,deck,site}/`, `frontend/hooks/deck/use-deck.ts`, `frontend/lib/decks.ts`, `backend/src/controllers/deck.ts`, `backend/src/repositories/deck-preparation.ts`, `backend/src/services/{presentation-planner,presentation-readiness,presentation-research,presentation-edit,studio-agent,studio-turn,live-interviewer}.ts`, `backend/src/workers/deck-preparation.ts`, `shared/presentation.ts`, `shared/voice-transcript.ts`.

## Frontend done

- Light and dark appearance across landing, sign-in, projects, conversation, research brief, deck review and live host controls. `/` and `/research`
- Live caption drafts, source-backed charts, private notes and questions, and a fullscreen slide stage. `frontend/components/{research,deck}/`
- Deck preparation uses the reviewed count, including a count written in the brief, with six as the fallback. Recovery offers a smaller deck, private source intake, private draft editing or same-count retry according to the failure. `frontend/components/deck/DeckWorkspace.tsx`
- Typed and spoken slide requests open preparation progress. Approved edits refresh Mission and reopen the exact saved revision with remaining review work visible. `frontend/components/{research/ResearchWorkspace,deck/ConversationSlideDiff}.tsx`

## Backend done

- OpenAI Decisions checks coverage before planning. Approved gap research feeds the same exact-count and independent grounding pipeline. `backend/src/workers/deck-preparation.ts`
- Spoken approval waits for the matching transcript after readback. Captions and saved turns keep call-scoped IDs. `backend/src/services/live-interviewer.ts` and `shared/voice-transcript.ts`
- Donut charts are supported in the planner prompt, validation and the shared renderer. `backend/src/services/{prompts,presentation-planner}.ts` and `shared/presentation.ts`
- Failed exact-count jobs persist the reason, attempted count, evidence gaps and any verified slides in an owner-only recovery draft. `backend/src/repositories/deck-preparation.ts`
- Generated slide edits require quoted sources and independent verification. The preview decision transaction advances the same pinned Mission deck only after approval. `backend/src/services/presentation-edit.ts` and `backend/src/controllers/deck.ts`
- Spoken commands correlate with late transcripts. Typed and spoken Mission changes are scoped to the captured revision and require new approval. `backend/src/services/{studio-turn,live-interviewer}.ts`

## Current module coverage: Module 2

| ID | Status | Evidence class | Evidence | Gap |
|----|--------|----------------|----------|-----|
| AC-1 | failed | live | The two authorized project replays reached nine and eight verified slides. Later exact-count repair rendered 10 of 10 from nine sections with synthetic inputs. `/private/tmp/copitch-live-market-retest.log` | The named India GDP project needs a new approved replay on current code. |
| AC-2 | verified | live | The public Apollo 11 job ran Decisions → gap research → Decisions → three verified, rendered slides. NASA corroborated the two added facts. The ready team and pilot cases skipped gap research. `/private/tmp/copitch-live-public-gap.log` and `/private/tmp/copitch-live-use-cases.log` | — |
| AC-3 | verified | fixture | A 12-slide request kept two verified slides and ten blank rows in a private draft. Chrome reopened and edited the draft, denied a second account, reopened the old revision, made two slides and focused the source intake. A simulated 503 persisted across reload and a retry created three reviewed slides at the original count. `/private/tmp/copitch-s2-evidence/browser-results.json` | — |
| AC-4 | verified | fixture | Duplicate request shared a job ID. Chrome closed during generation and fresh browsers restored the same revision and ordered slides. Presentation required approval. `/private/tmp/copitch-release-ac4.mjs` | — |
| AC-5 | verified | fixture | Chrome passed eight appearance-and-width combinations at 390, 768, 1024 and 1440 CSS pixels. Keyboard review controls were reachable and no horizontal overflow appeared. `/private/tmp/copitch-final-visual-qa/browser-matrix.log` | — |
| AC-6 | verified | fixture | The gate audit classified count, source and budgeting limits. Instruction and handoff checks validated current entry points. `docs/audit/07-presentation-gates.md` and `docs/audit/08-agent-prompts.md` | — |
| AC-7 | verified | fixture | Chrome followed the landing action, signed in, opened an existing project, created an empty one and used a sample prompt to fill the composer. `/private/tmp/copitch-final-visual-qa/browser-matrix.log` | — |
| AC-8 | verified | fixture | Chrome exercised artifact navigation and cited research at four widths with keyboard focus restored. The populated fixture showed saved intent and job state. `/private/tmp/copitch-design-qa/studio-rail.log` | — |
| AC-9 | verified | fixture | Chrome navigated the ten-slide filmstrip and host review controls. Projector-size review and offline HTML verified legible charts and no private notes or names. `/private/tmp/copitch-final-visual-qa/browser-matrix.log` and `scripts/check-html-deck.ts` | — |
| AC-10 | verified | fixture | Chrome simulated speech interruption, pinned the active sentence, returned a grounded answer privately and continued at the same position. Another run verified a paused typed question, stage-only fullscreen and return focus. `/private/tmp/copitch-room-voice-check.mjs` and `/private/tmp/copitch-studio-exact-acceptance.mjs` | — |
| AC-11 | verified | fixture | 237 backend tests passed across 40 files. The Bun backend bundle, production Next build and scoped TypeScript and lint passed. Ten Chrome checks covered recovery, retry, source intake, typed and synthetic voice commands, and Mission review of the exact approved revision. Prior fixture checks cover scoring, three HTML sizes and live controls. `/private/tmp/copitch-s2-evidence/backend-all.log`, `/private/tmp/copitch-s2-evidence/frontend-build.log`, `/private/tmp/copitch-s2-evidence/browser-results.json`, and `/private/tmp/copitch-final-visual-qa/browser-matrix.log` | — |
| AC-12 | unverified | none | Real OpenAI Live in Chrome painted a synthetic host caption at 1.87 seconds before persistence. One approval of the revised plan completed one job and closed the mic. The synthetic English → Telugu → English turns saved in order. With microphone permission denied, typed input still saved. `/private/tmp/copitch-spoken-release/` | Physical microphone and acoustic playback remain unverified. |
| AC-13 | unverified | none | Live provider runs completed team introduction 2 of 2, pilot outcomes 3 of 3 with a donut and fictional market briefing 10 of 10. The synthetic CSV voice job completed and its saved research replay produced 24 versus 18 and a 12-minute median on separate slides, with cited live Q&A and same-sentence resume. `/private/tmp/copitch-market-settled.log` and `/private/tmp/copitch-spoken-release/replay-synthetic-deck-with-trace.log` | Full live briefing and interruption still need verification in each contracted case. |
| AC-14 | verified | fixture | Both theme selections survived navigation and refresh in desktop and mobile Chrome. `/private/tmp/copitch-final-visual-qa/browser-matrix.log` | — |

Owner decisions pending: New authorization for the saved India GDP replay and review before AWS deployment.

## Next module plan

1. Use the website walkthrough to turn a bounded approved crawl into a private saved PowerPoint, then verify it in a fresh browser. `handoffs/3-website-to-powerpoint.md`
