# Handoff: Live HTML presentation (module 2)

Contract: handoffs/2-live-presentation.contract.md

Commit/base: 715b534 + uncommitted changes

Files changed: deck preparation queue, readiness and repair planning, Playwright renderer, host slide and microphone controls, browser rehearsal, and product and architecture documentation

## Frontend done

- The conversation asks only **How many slides?**, then opens the checked deck. The live view stays on the current screen. `frontend/components/deck/SlideCountPrompt.tsx`, `frontend/components/deck/DeckWorkspace.tsx`, `frontend/components/deck/LiveDeck.tsx`
- Presentation observation survives reload. The microphone compares capture with a recent speaker reference and preserves real speech over the narration. `frontend/hooks/deck/use-deck.ts`, `frontend/lib/room-utterance.ts`

## Backend done

- Store structured verified research and use it to assess readiness, plan, and independently check the deck. `backend/src/services/research.ts`, `backend/src/services/presentation-planner.ts`
- Queue slide preparation in SQLite. Chromium renders the same templates as the host, and layout repairs run within three whole-deck passes. `backend/src/workers/deck-preparation.ts`, `backend/src/services/deck-render-review.ts`
- Fence each narrated sentence and private edit with the approved revision, slide paint and command state. `backend/src/controllers/presentation-live.ts`, `backend/src/repositories/presentation-live.ts`

## Current module coverage: Module 2

| ID | Status | Evidence class | Evidence | Gap |
|----|--------|----------------|----------|-----|
| AC-1 | verified | live | `simulations/presentation/chrome-acceptance.mts` produced independently accepted, distinct one- and two-slide plans. Read-only replay of the reported ten-slide request recovered nine distinct verified slides and passed the second Chromium review. The signed-in Chrome fixture preserved the chart's 1,200 and 1,500 values in the deck and HTML. | The saved research did not substantiate a tenth distinct slide. |
| AC-2 | verified | fixture | `scripts/check-pitch-studio.ts` observed host stage paint HTTP 204, a single page, and equivalent chart data in the offline HTML. The separate audience route returned 404. | — |
| AC-3 | verified | live | Configured-provider Chrome rehearsal captured a recorded question from a browser audio track, interrupted narration and held sentence zero. A separate recording-plus-echo fixture observed no echo-only upload and cut playback in 161 ms and 191 ms when it added host speech. | AC-9 covers the physical device. |
| AC-4 | verified | live | The same configured-provider run transcribed the question, returned the cited figure 24, spoke the answer, and resumed sentence zero. | — |
| AC-5 | verified | live | The configured-provider run rejected one proposal without changing revision, applied a separate host-attributed change as revision two, painted the revised slide, and spoke the new sentence before advancing. | — |
| AC-6 | verified | fixture | Chrome reloaded after the 202, resumed polling the same job, and opened the saved deck. `backend/tests/deck-preparation.test.ts` and `backend/tests/presentation-live.test.ts` exercise lease, ownership and stale playback fencing. | — |
| AC-7 | verified | live | The configured-provider Chrome runner completed account creation, files-only research, private research reopen, the inline slide-count question, reload during preparation, checked deck, HTML download and audible same-page presentation. | — |
| AC-8 | verified | fixture | A deliberately overflowing slide produced browser overflow feedback, passed independent model repair, and cleared the problem on its second real Chromium render. `backend/tests/deck-render-review.test.ts` proves the hard three-pass limit and that a failed review returns no deck. | — |
| AC-9 | unverified | live | An isolated Chrome launched through macOS opened the built-in microphone and selected the built-in speakers. Automatic gain reproduced a false interruption. After disabling it, the quiet-room fixture observed playback without an interrupt or upload. The startup and echo Chrome fixture still accepted one independent overlapping audio track. | The physical run reached its listening window without an overlapping utterance reaching the app. Confirm with a person speaking in the room. |

Owner decisions pending: none

## Next module plan

1. Rehearse echo-only playback and natural overlapping speech on the event laptop. Verify playback resumption at the interrupted sentence on that hardware.
