# copitch audit · 2026-11-21

This is a read-only audit. No product code was changed.

| File | Answers |
|---|---|
| [01-doc-contradictions.md](01-doc-contradictions.md) | Which docs contradict each other or the code (21 doc items, 4 code items, ranked) |
| [02-eval-methodology.md](02-eval-methodology.md) | Why each design decision holds, the metrics and edge cases per stage, the current scorecard |
| [03-ux-design-direction.md](03-ux-design-direction.md) | What looks unfinished and why; new palette, type, layout, flow, charts, interactions |
| [04-system-design.md](04-system-design.md) | The architecture as built, authority boundaries, flows, data, failure handling, risks |
| [05-pitch.md](05-pitch.md) | A 5-minute demo pitch with claims sized to the evidence |
| [06-codex-agents.md](06-codex-agents.md) | Why the Codex agents ship bugs behind green checks, and the new `senior_engineer` agent |

## Verdict

The engineering is strong and mostly verified (144/144 backend tests, live-provider Chrome runs for Modules 1 and 2). Three things make it look weaker than it is:

1. **The docs disagree about what the product is.** The biggest disagreements are the context brief versus the deck as the deliverable, Realtime versus Live versus Pipecat, and whether an audience view exists.
2. **The visible surface undersells it.** Slides use about 30% of the canvas, charts are thin progress bars, the cited brief has no viewer, and the agent's understanding is invisible.
3. **The evals are thin exactly where AI engineers will probe.** There are no labelled sets for speech accuracy by language, routing accuracy or entailment precision.

## Owner decisions needed before any rebuild

1. **Module 1 output:** restore the cited brief as a first-class artifact (recommended), or keep the deck-only flow.
2. **Audience display:** a single screen with fullscreen presenter mode (recommended; delete the dead audience backend), or a second screen. Module 3 depends on this.
3. **Visual direction:** adopt the "Studio" system in Audit 3. This changes `frontend/AGENTS.md`.
4. **Live routing:** use the Decisions API for utterance routing and consent (architecture in Audit 2 §2.5), or stay with generative routing.
