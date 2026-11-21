# Contract: Live HTML presentation (module 2)
Owner decisions pending: additional export formats and hosted rehearsal
Source: docs/module-2-prd.md#5-requirements, docs/module-2-html-presentation.md#interrupt-propose-and-continue

| ID | Actor action | Observable outcome | Check (entry point + exact command or click path) | Required evidence |
|----|--------------|--------------------|---------------------------------------------------|-------------------|
| AC-1 | Host plans a presentation from saved context | Audience and time shape the reviewable slide order and narration. Every displayed figure traces to the saved evidence | Open the saved context in `/research`, create a deck, and compare two audiences in deck review | live |
| AC-2 | Host approves and presents the deck | The scoped audience page paints the same approved slide as the host and the HTML export. Playback waits for its paint acknowledgement | Open the review and audience link in separate browser contexts, approve, present, and compare the exported HTML | fixture |
| AC-3 | Host speaks during a sentence | The host player stops, the current slide stays up, and the saved attempt identifies the interrupted sentence | Present an approved deck, interrupt mid-sentence, and inspect the cursor and the stopped attempt | live |
| AC-4 | Host asks a question during delivery | A cited answer uses eligible evidence. The deck revision stays the same and the controller can resume the interrupted sentence | Ask a relevant question from the room mic and inspect the host answer, evidence and resume cursor | live |
| AC-5 | Host proposes a relevant addition and chooses Apply or Reject | Host sees the exact before/after. Apply commits once and waits for the accepted slide to paint before advancing. Reject keeps the original slide and stays paused | Replay Apply against the same proposal, then repeat for Reject and a stale revision in the normal live controller | fixture |
| AC-6 | Host or audience reconnects | The audience shows only the last approved slide. The host recovers the paused cursor and pending review. Old playback callbacks cannot advance | Reload both browser contexts during a pending change, then send an old attempt acknowledgement | fixture |
| AC-7 | Host goes from a new project to live delivery in one studio | The same account approves research, reopens the same saved `context.md`, reviews and approves a deck, and starts playback. The audience link and export expose the approved public slides | `bun simulations/presentation/chrome-acceptance.mts` against the running native browser preview with configured providers | live |

Out of scope: container builds, Module 3, public hosting
Invariants: approved revision only, stable slide and attempt IDs, exact host approval, separate audience projection, private notes and drafts, idempotent commands
