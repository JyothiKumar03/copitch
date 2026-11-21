# Handoff: Goal-driven research (module 1)

Contract: handoffs/1-goal-driven-research.contract.md

Commit/base: d0196ac + uncommitted changes

Files changed: research runner, provider, tools, worker, grounding, and pitch services, studio intent and notes, backend tests, `simulations/studio`, product and architecture docs

## Frontend done

- The studio opens saved `context.md` from the conversation, renders validated bar and line charts, links the cited sources and exposes the exact Markdown download. The activity view distinguishes tool steps, pages read and passes.

## Backend done

- The model chooses native web search or URL reading within the approved scope and a 10-tool-step budget per pass. Page coverage follows the question and source scope. The leased worker checkpoints tool results. Publication binds evidence IDs to retrieved passages and verifies claims independently — `backend/src/services/research-agent.ts`, `backend/src/services/research.ts`, `backend/src/services/research-grounding.ts`
- The same approved brief preserves typed and verbatim spoken facts. Assistant suggestions do not become host evidence — `backend/src/services/studio-turn.ts`

## Current module coverage: Module 1

| ID | Status | Evidence class | Evidence | Gap |
|----|--------|----------------|----------|-----|
| AC-1 | verified | fixture | `bun test backend/tests/research-agent.test.ts backend/tests/studio-turn.test.ts` → tool selection, failed step accounting, 10-call cap and retained approved intent passed | — |
| AC-2 | verified | fixture | `bun test backend/tests/studio-research.test.ts` → files-only verified artifact with zero lookups | — |
| AC-3 | verified | fixture | `bun test backend/tests/studio-research.test.ts` → replacement lease published after a saved search, with one provider call. `scripts/check-pitch-studio.ts` → Chrome worker restart and fresh-context reopen passed | — |
| AC-4 | verified | fixture | `bun test backend/tests/studio-research.test.ts` → missing evidence and empty independent verdicts withheld the artifact | — |
| AC-5 | failed | live | Latest configured-provider portfolio run → 28/29, three distinct pages, ten tool steps and one pass; cited roles and the corrected project name passed. | The draft described the ML Projects entry without preserving its source title. |
| AC-6 | verified | live | Fresh Chrome account → 4 steps, 2 official pages, 1 pass, one verified chart and exact Markdown download. The chart shows MPEDA's comparable FY 2025–26 product values and links their source. The report includes the distinct October and April–October figures and frozen-fish volume. | The guided case supplied the two approved official URLs. |
| AC-7 | verified | live | Native Chrome sign-up, consent, files-only context and fresh sign-in passed. `simulations/studio/research_eval.ts` preserved the number 24 with zero lookups and no visible host footnotes. | Physical microphone path unverified |

| AC-8 | verified | fixture | `scripts/check-pitch-studio.ts` exercised exact SSE/download bytes, chart values, worker restart, fresh sign-in and cross-account denial. Chrome also prepared and approved Module 2 directly from the context. | Hosted rehearsal remains open. |

Owner decisions pending: none

## Next module plan

1. The same project can prepare and approve Module 2 from the saved context. Rehearse the portfolio and public market cases over the hosted service after the local owner check.
