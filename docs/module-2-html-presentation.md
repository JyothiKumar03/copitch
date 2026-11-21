# Module 2 · Plan, render, and present an HTML deck

The host opens a saved Module 1 context, reviews an HTML deck and its private narration, then starts presenting. A relevant new point spoken during a slide can become a proposed edit. The host sees what would change and decides whether the audience should see it.

## Build on the existing deck

The existing planner orders slides derived from the verified memo. The deck stores stable slide IDs, evidence IDs, layout, highlights and private narration. The host already has a side-by-side revision review. The audience stage and offline export render similar HTML with separate implementations. Reuse the deck, revision repository and continuation reducer. Extend the planner, share the public slide view and connect spoken interruptions to the revision flow. [Planner](../backend/src/services/pitch.ts) · [Deck schema](../backend/src/types/deck.ts) · [Private review](../frontend/components/deck/DeckWorkspace.tsx) · [Offline export](../frontend/lib/export-deck.ts)

The [detailed Module 2 PRD](module-2-prd.md#4-reference-analysis-live-slides) records the sibling `live-slides` review. Use structured beats, bounded factual layouts and attempt-correlated playback. Copitch uses one public slide projection for the host, audience and HTML export, and its controller owns review, revision changes and advancement.

## Plan the story before rendering

Pass the saved research revision, verified evidence, supported charts, and the requested maximum slide count to the planner. Use the purpose already established in the brief. Ask it for a sequence of slide proposals. Each proposal specifies a takeaway, the visible content, why it belongs at that point, cited evidence and narration beats with a time estimate. Narration can explain what a number means or qualify a claim. The host reviews it separately from the projected slide. Save the accepted plan as a deck revision before starting delivery. The host screen is the default stage. [The presentation flow and diagrams](presentation-flow.md) describe microphone permission and the interruption sequence.

| Template | Visible on stage | Narration job |
|---|---|---|
| Opening | One headline and a short framing line if needed | Introduce the subject, audience relevance and what they should take away. |
| Evidence | A claim and up to three short supporting lines, with source references | Explain the supporting facts and their limits. |
| Comparison | A claim and one chart or labeled table, with units, periods and source references | Explain the meaningful difference, the denominator and what remains uncertain. |
| Takeaway | One conclusion and a next action when the audience has one | Recap the decision or takeaway and hand the floor back. |

Use the existing headline, evidence and takeaway layouts. Comparison can be an evidence layout with structured data. Choose the template from the shape of the evidence. Render through a shared public view model so host preview, audience stage and standalone HTML agree on the approved words and data. Render plain text with trusted CSS templates. Keep private narration, interview history and pending edits out of the public view and export. Reject comparable-data charts with incompatible units or definitions. Flag overflow in preview so the planner can shorten or split a slide for review.

## Interrupt, propose, and continue

1. When the host starts speaking, stop current playout and mark the interrupted narration beat as unfinished. Capture the slide ID, deck revision and playback attempt at interruption onset. Process the finalized turn once. Fence callbacks from older attempts and keep the approved slide visible while the host speaks.
2. Give the intent model the current slide and private narration, nearby slide titles, relevant verified evidence, the finalized host turn and current playback state. Determine whether the host is asking a question, directing playback, correcting the current slide, adding a relevant new point, or referring to another slide. Clarify ambiguous targets. A useful new point may be absent from the deck. A statement with no evidence can be proposed as explicitly host-supplied when its attribution is suitable for the audience.
3. For a relevant new point or correction, check whether it is already covered, whether it conflicts with evidence, and whether it belongs on-screen or in narration. Return a small typed patch against the interrupted slide. The controller validates the evidence, scope, layout and base revision. Show changed title, claims, data and narration separately in the host's before/after preview. Expose source or host attribution beside the change.
4. **Accept and advance.** Apply the patch once against the reviewed revision, publish the accepted slide and wait for the audience stage to paint it. Make the accepted point visible before advancing. If the change added an essential spoken beat, deliver it or let the host explicitly skip it. Then move to the next planned slide, or finish after the final slide. If the stage loses its connection during this step, keep the accepted revision and hold the cursor until the stage returns. The control must state whether it will speak an added beat before advancing.
5. **Reject.** Discard the proposal and stay on the current approved slide. Leave playback paused until the host chooses Resume or Next. Resume at the earliest unfinished beat. A second interruption cancels older pending work or asks the host which proposal to retain. Reconnect restores the accepted revision, pending private review and continuation position with playback paused.

The host’s acceptance authorizes the reviewed patch and the transition. A model reply, audience question, idle silence or provider playback callback has no authority to edit or advance. A later explicit instruction to change a different slide names that slide and receives its own review.

The approval command carries `proposal_id`, `deck_id`, `slide_id`, `base_revision` and an idempotency key. Commit the accepted revision and the pending advance together. The pending advance references the accepted revision and the current stage epoch. A matching paint acknowledgement can consume it once. If delivery is paused or the stage is behind, the command remains pending. This closes the gap where a successful database write could skip the slide before the audience sees the added point. [Existing revision decisions](../backend/src/repositories/deck.ts) · [Playback and stage observations](../backend/src/services/continuation.ts)

### Example review

Slide 3 shows “12 teams joined the pilot.” During narration, the host says, “Add that six were repeat customers.” If the evidence supports the count, show one added bullet, “6 of the 12 teams were repeat customers,” and the proposed narration sentence beside its citation. Keep the title and original bullet visible in the preview. If the statement comes from the host alone, the proposal identifies that explicitly. If “six” could refer to another cohort, ask which cohort before proposing an edit.

## Build order and acceptance

| Exit check | Evidence to capture |
|---|---|
| M2-1 · Plan from saved context | Use the same research context with two slide limits. Inspect the grouping, chart and layout choices and the separate narration. Verify the plan stays within the requested slide ceiling and every factual claim traces to evidence. |
| M2-2 · Render one approved revision across surfaces | Compare host preview, host live stage and offline HTML. Check chart units, source references, keyboard navigation, phone and projector sizes, and privacy of exported content. |
| M2-3 · Interrupt during speech | Capture speech onset-to-cutoff and the continuation cursor in a physical laptop rehearsal. Answer a question without proposing an edit. Repeat with a useful new point and confirm the audience stays on the approved slide during review. |
| M2-4 · Accept or reject the exact diff | Accept once, see the added point on the stage, then see the next slide only after the accepted update paints. Repeat with Reject and confirm that the old revision remains and the stage stays in place. Repeat an approval and replay a stale one to verify that neither creates another revision. |
| M2-5 · Recover from ambiguous speech and disconnect | Interrupt twice, refer to an ambiguous slide, and disconnect during review. Verify old audio stops, ambiguous intent asks for clarification, and reconnect restores the last approved view and pending review privately. |

Use the [detailed PRD](module-2-prd.md#8-acceptance) for the full acceptance checks and the [Module 2 contract](../handoffs/2-live-presentation.contract.md) for the HTML release path. Rehearse the full sequence on the event laptop before beginning Module 3 browser walkthroughs.
