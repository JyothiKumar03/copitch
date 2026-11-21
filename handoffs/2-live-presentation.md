# Handoff: Live HTML presentation (module 2)

Contract: handoffs/2-live-presentation.contract.md

Commit/base: d0196ac + uncommitted changes

Files changed: deck planner and types, presentation state and routes, audience projection, private voice adapter, deck UI and HTML exporter, presentation tests and acceptance docs

## Frontend done

- Host review, separate audience stage and offline HTML display the same public slide. The host sees private source-backed diffs and narration — `frontend/components/deck/`, `frontend/lib/export-deck.ts`
- Optional room mic interrupts playout locally and captures a fenced turn. Typed and manual Talk remain available — `frontend/hooks/deck/use-presentation-mic.ts`

## Backend done

- The planner builds bounded, evidence-backed slides and sentence beats from verified research. The controller persists cursor, attempts, pending edits and stage sequence — `backend/src/services/presentation-planner.ts`, `backend/src/repositories/presentation-live.ts`
- Scoped paint unlocks approved narration. Live answers and additions use cited records and a grounding check. The voice worker generates approved clips and caches exact inputs — `backend/src/controllers/presentation-live.ts`, `backend/src/services/presentation-grounding.ts`, `voice/server.py`

## Current module coverage: Module 2

| ID | Status | Evidence class | Evidence | Gap |
|----|--------|----------------|----------|-----|
| AC-1 | verified | live | A configured-provider run against the same stored personal context produced three independently verified operations slides and two hiring slides. The hiring review rejected one unsupported beat and retained the two verified beats. | Portfolio audience variants remain a separate check. |
| AC-2 | verified | live | Native Chrome signed-in flow → approved deck, audible MP3, separate audience and offline HTML. Separate fixture → renderer parity, six paints and revision 2 private-safe offline HTML | Physical projector rehearsal unverified |
| AC-3 | unverified | live | `simulations/presentation/live-smoke.ts` → live narration MP3, pinned interruption and old audio rejected. Chrome AudioWorklet fixture → prerecorded speech interrupted playback and reached transcription. Native Chrome also interrupted live audio via the host control. | Physical mic and room acoustics unverified |
| AC-4 | unverified | live | `simulations/presentation/live-smoke.ts` → private transcription accepted synthesized speech, one source citation, live answer MP3 and resume at the same sentence | Live multilingual room routing and physical latency remain unverified. |
| AC-5 | verified | live | `bun test backend/tests/presentation-live.test.ts` → rejected edit preserved revision, repeated Apply committed once, revised slide painted before essential narration and advance. Live smoke committed revision 2 once and advanced after paint. | — |
| AC-6 | verified | fixture | `bun test backend/tests/presentation-live.test.ts` and isolated Chrome → expired paint lease held the cursor, fresh paint resumed it, stale callbacks fenced and private review preserved | Hosted reconnect rehearsal unverified |
| AC-7 | verified | live | Native Chrome approved a files-only brief, reopened byte-identical context after fresh sign-in, prepared a deck, exported HTML and observed playback on the approved stage. The same run answered a cited question, rejected an edit, then applied a new edit and played it after the separate audience stage painted revision 2. | Physical room and hosted rehearsal remain open. |

Owner decisions pending: additional export formats and hosted rehearsal

Local rehearsal: `http://localhost:3190/research` runs both modules with the existing preview accounts and projects.

## Next module plan

1. Rehearse multilingual voice on the event laptop. Use the approved, painted deck cursor as the handoff point for a Module 3 walkthrough.
