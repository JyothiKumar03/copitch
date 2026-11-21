# Handoff: Deck recovery and SaaS studio (module 2)

Contract: handoffs/2-deck-recovery-and-studio.contract.md
Commit/base: Exact-count recovery `fd76927`, studio `5fd1d39`, live review `56e8d4e` and final caption timing `fac001e`.
Files changed: `frontend/app/globals.css`, `frontend/components/{home,projects,research,deck,site}/`, `backend/src/services/{presentation-planner,presentation-readiness,presentation-research,studio-agent,live-interviewer}.ts`, `backend/src/workers/deck-preparation.ts`, `shared/presentation.ts`, `shared/voice-transcript.ts`.

## Frontend done

- Light and dark appearance across landing, sign-in, projects, conversation, research brief, deck review and live host controls. `/` and `/research`
- Live caption drafts, source-backed charts, private notes and questions, and a fullscreen slide stage. `frontend/components/{research,deck}/`

## Backend done

- OpenAI Decisions checks coverage before planning. Approved gap research feeds the same exact-count and independent grounding pipeline. `backend/src/workers/deck-preparation.ts`
- Spoken approval waits for the matching transcript after readback. Captions and saved turns keep call-scoped IDs. `backend/src/services/live-interviewer.ts` and `shared/voice-transcript.ts`
- Donut charts are supported in the planner prompt, validation and the shared renderer. `backend/src/services/{prompts,presentation-planner}.ts` and `shared/presentation.ts`

## Current module coverage: Module 2

| ID | Status | Evidence class | Evidence | Gap |
|----|--------|----------------|----------|-----|
| AC-1 | failed | live | The two authorized project replays reached nine and eight verified slides. Later exact-count repair rendered 10 of 10 from nine sections with synthetic inputs. `/private/tmp/copitch-live-market-retest.log` | The named India GDP project needs a new approved replay on current code. |
| AC-2 | verified | live | The public Apollo 11 job ran Decisions → gap research → Decisions → three verified, rendered slides. NASA corroborated the two added facts. The ready team and pilot cases skipped gap research. `/private/tmp/copitch-live-public-gap.log` and `/private/tmp/copitch-live-use-cases.log` | — |
| AC-3 | verified | fixture | Files-only and provider-error paths returned actionable failures, preserved the old variant, and retried to ten without a public search. The browser kept the requested count. `/private/tmp/copitch-product-check.ts` and `/private/tmp/copitch-release-ac3.mjs` | — |
| AC-4 | verified | fixture | Duplicate request shared a job ID. Chrome closed during generation and fresh browsers restored the same revision and ordered slides. Presentation required approval. `/private/tmp/copitch-release-ac4.mjs` | — |
| AC-5 | verified | fixture | Chrome passed eight appearance-and-width combinations at 390, 768, 1024 and 1440 CSS pixels. Keyboard review controls were reachable and no horizontal overflow appeared. `/private/tmp/copitch-final-visual-qa/browser-matrix.log` | — |
| AC-6 | verified | fixture | The gate audit classified count, source and budgeting limits. Instruction and handoff checks validated current entry points. `docs/audit/07-presentation-gates.md` and `docs/audit/08-agent-prompts.md` | — |
| AC-7 | verified | fixture | Chrome followed the landing action, signed in, opened an existing project, created an empty one and used a sample prompt to fill the composer. `/private/tmp/copitch-final-visual-qa/browser-matrix.log` | — |
| AC-8 | verified | fixture | Chrome exercised artifact navigation and cited research at four widths with keyboard focus restored. The populated fixture showed saved intent and job state. `/private/tmp/copitch-design-qa/studio-rail.log` | — |
| AC-9 | verified | fixture | Chrome navigated the ten-slide filmstrip and host review controls. Projector-size review and offline HTML verified legible charts and no private notes or names. `/private/tmp/copitch-final-visual-qa/browser-matrix.log` and `scripts/check-html-deck.ts` | — |
| AC-10 | verified | fixture | Chrome simulated speech interruption, pinned the active sentence, returned a grounded answer privately and continued at the same position. Another run verified a paused typed question, stage-only fullscreen and return focus. `/private/tmp/copitch-room-voice-check.mjs` and `/private/tmp/copitch-studio-exact-acceptance.mjs` | — |
| AC-11 | verified | fixture | 169 backend tests, 13 frontend tests, six scoring tests, three HTML sizes and the direct TypeScript and lint checks passed. Browser fixtures checked retry, reopen, research, review and live controls. `/private/tmp/copitch-voice-release-backend.log` and `/private/tmp/copitch-final-visual-qa/browser-matrix.log` | — |
| AC-12 | unverified | none | Real OpenAI Live in Chrome painted a synthetic host caption at 1.87 seconds before persistence. One approval of the revised plan completed one job and closed the mic. The synthetic English → Telugu → English turns saved in order. With microphone permission denied, typed input still saved. `/private/tmp/copitch-spoken-release/` | Physical microphone and acoustic playback remain unverified. |
| AC-13 | unverified | none | Live provider deck runs completed team introduction 2 of 2, pilot outcomes 3 of 3 with a donut and fictional market briefing 10 of 10. `/private/tmp/copitch-live-use-cases.log` and `/private/tmp/copitch-live-market-retest.log` | Full live briefing and interrupted presentation for each case still need observation. |
| AC-14 | verified | fixture | Both theme selections survived navigation and refresh in desktop and mobile Chrome. `/private/tmp/copitch-final-visual-qa/browser-matrix.log` | — |

Owner decisions pending: New authorization for the saved India GDP replay and review before AWS deployment.

## Next module plan

1. Use the website walkthrough to turn a bounded approved crawl into a private saved PowerPoint, then verify it in a fresh browser. `handoffs/3-website-to-powerpoint.md`
