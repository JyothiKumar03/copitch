# Contract: Live HTML presentation (module 2)
Owner decisions pending: additional export formats and hosted rehearsal
Source: docs/module-2-prd.md#5-requirements, docs/module-2-html-presentation.md#interrupt-propose-and-continue

| ID | Actor action | Observable outcome | Check (entry point + exact command or click path) | Required evidence |
|----|--------------|--------------------|---------------------------------------------------|-------------------|
| AC-1 | Host plans a presentation from saved research | One count bounds slide grouping, chart choice and narration. The agent checks readiness and every displayed figure traces to evidence | Prepare two decks at different ceilings for the same saved research revision | live |
| AC-2 | Host approves and presents the deck | The approved slide opens in the host's browser and matches the HTML export. Playback waits for its paint acknowledgement | Choose Approve and present in the review, confirm the current page receives a paint acknowledgement, and compare the exported HTML | fixture |
| AC-3 | Host speaks during a sentence | The host player stops, the current slide stays up, and the saved attempt identifies the interrupted sentence | Present an approved deck, interrupt mid-sentence, and inspect the cursor and the stopped attempt | live |
| AC-4 | Host asks a question during delivery | A cited answer uses eligible evidence. The deck revision stays the same and the controller can resume the interrupted sentence | Ask a relevant question from the room mic and inspect the host answer, evidence and resume cursor | live |
| AC-5 | Host proposes a relevant addition and chooses Apply or Reject | Host sees the exact before/after. Apply commits once and waits for the accepted slide to paint before advancing. Reject keeps the original slide and stays paused | Replay Apply against the same proposal, then repeat for Reject and a stale revision in the normal live controller | fixture |
| AC-6 | Host reloads or returns to the project | The pending preparation or last saved revision is recoverable. Old playback callbacks cannot advance | Reload during preparation and check the same job ID. Exercise stale playback callbacks through the controller | fixture |
| AC-7 | Host goes from a new project to live delivery | Research stays in the project. The host reviews and approves the one deck on the current screen. The HTML export contains only the public slides | `node simulations/presentation/chrome-acceptance.mts` against an isolated preview with configured providers | live |
| AC-8 | Host waits for visual review | The complete shared-template deck is rendered, failed layouts can be repaired, and at most three passes are charged before an error | Render an overflowing fixture in Chrome and run the layout repair. Force a persistent failure in the capped-loop fixture | fixture |
| AC-9 | Host uses physical room audio | Playback alone causes no interrupt or upload. A person talking over the speakers interrupts and can ask a question | Run echo-only and double-talk with a physical microphone and speakers, then compare the pinned sentence after the answer | live |

Out of scope: container builds, Module 3, public hosting
Invariants: approved revision only, stable slide and attempt IDs, exact host approval, host-screen stage, private notes and drafts, idempotent commands
