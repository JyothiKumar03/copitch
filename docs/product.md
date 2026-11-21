# Product · From a spoken idea to a live presentation

## The promise
A founder opens a new session and hears “What are you presenting, and who will be listening?” They speak freely, attach a previous pitch and a spreadsheet, and say “Research the buyer's public priorities and build me a five-minute pilot pitch.” The presenter interviews them, investigates the topic, prepares slides and notes, and waits in preview. In the room it can narrate, answer, revise a chart or guide a live website walkthrough. A saved deck reflects the actual conversation.

## What each stage contributes
| Stage | What comes in | What the user gets | Transition |
|---|---|---|---|
| Start | New or saved project, mic permission | Private host workspace; agent greets once after user gesture. Text works alongside voice. | New enters briefing. Reopen restores the latest saved state paused. |
| Brief | Spoken idea, audience, outcome, time, tone, exclusions, optional files or URLs | A correctable summary in the host's words. Ask one material follow-up, e.g. “What do you want the buyer to agree to?” Use stated defaults for optional fields. | “Build it” confirms the version. “Only my files” restricts research. |
| Research | Confirmed brief, parsed attachments and unanswered research questions | Progress by question, new public sources, citation locations and unresolved gaps. Host may keep talking. | Enough evidence starts drafting. Partial coverage offers proceed with supported claims, add a source, or retry. |
| Draft | Brief and evidence version, CSV schema and permitted layouts | Agent-planned story with chart, citations, short narration beats and optional website cue. | Draft opens in review. Invalid slide data stays private until corrected. |
| Review | Draft, source panel and spoken corrections | Reorder, revise a slide or change the brief. Preview the actual audience view. | “Present” or Start Presentation arms live mode. Deck generation alone never starts public narration. |
| Present | Approved revision, working audio, audience display | First slide paints, then narration starts. Silence during narration continues the talk; silence after a question holds position. | End of final beat offers Finish or Q&A. Manual advance, interruption and demo commands work throughout. |
| Interact | Host speech, Talk button or typed command | Yield, answer with evidence, preview/apply edit, clarify or pause. “Stop” holds. “Stop and show enterprise only” pauses and previews one chart edit for approval. | Continue resumes at latest revision. Shared-room input requires host approval for edits or navigation. |
| Demo | A supplied URL or planned cue, host goal | Real page on the audience stage, visible navigation and narration based on observed content. Host can redirect or take over. | Back restores slide and updated talking point. Website navigation alone does not rewrite the deck. |
| Finish | Latest committed revision | Save session and export PPTX. Text stays editable and chart is an image for MVP. | Export failure can be retried against the same revision. |

## Who sees what
Host sees transcript, research progress, gaps, notes, approvals, mic mode, URL entry and Undo. Audience sees the slide or live page and a relevant visual cue. One host tab plays room audio. Optional private spoken coaching needs headphones; default private guidance is text. One authenticated host can invite questions using the same mic. Independently connected speakers are a future room feature.

## Supported scope and edges
- Text PDF, PPTX text, CSV and accessible public webpages. Treat an uploaded presentation as content in this release. Custom PPTX template mapping is the next rendering milestone.
- Private claims come from the host or attachments. Public research uses public-safe queries. File-only mode disables external research. Conflicting claims keep their dates and definitions; leave a gap when unresolved.
- One grounded chart transformation, three default slide layouts, a bounded website tour and a real export. Runtime web demo supports approved public origins. If origin isolation is unverified, demo on approved sites and clearly disclose that constraint.
- Denied mic gives typed intake and controls. Poorly transcribed names, amounts or URLs get confirmation when consequential. A browser or audio failure leaves the host with slides and manual controls.
- Revisions survive interruption. Retry, refresh or disconnect returns to the last committed state. Ending a session during a pending operation invalidates that operation.

## First deliverable · a research brief you can present from

The first research run produces a downloadable presentation.md that reads as a standalone research memo. Start with the audience’s question and the decision they face. Explain findings in connected prose, cite the evidence beside each external claim, and preserve caveats, numbers with units, unanswered questions and useful follow-ups. Keep host requests attributed. The deck compiler runs after the memo is ready.

The interviewer checks what the query already resolves. Ask the one unanswered question most likely to change what gets researched. For “research onboarding,” ask who is being onboarded and to what end. A clear buyer, objective and scope can go straight to confirmation. With permission, discover public sources or read the specific URLs supplied. Report unreadable pages and invite pasted text. Source-restricted research uses the material the host supplied.

For delivery, create a separate story plan. Each visual carries one main takeaway and the minimum evidence the audience needs to see. The voice explains its meaning for this audience, its limitations and how it connects to the decision. For example, a visual can show “Enterprise 20% · Overall 10%”. The presenter might say “Four of twenty enterprise trials converted. That makes enterprise worth testing in a pilot, though the sample is small and we don’t yet know why the groups differ.” Preserve the denominator and qualify the recommendation.

The planning agent chooses the slide count, order and pacing from the audience, objective, evidence and available time. It shows a short rationale in review. The host may specify a count or override the proposed plan. A website tour, Q&A detour or clarification consumes presentation time but does not create a slide. The host sees a duration estimate including planned demos. With a custom template outside the supported set, retain the uploaded file as evidence and offer the built-in layouts explicitly.

## Interruption, consent and walkthrough roles

On an interruption, yield and pin the current target. A question gets an answer from the approved deck, its linked evidence or a permitted calculation. For a supplied PPTX, cite the original slide number. If the answer depends on data outside the presentation, explain the gap and offer a scoped lookup. A new observation stays attributed to the host. Ask whether to incorporate it if that is unclear. A requested content change produces a private before/after diff for the affected highlight, figure, narration and source. Spoken or clicked Apply commits that proposal once against its base revision. Keep original or dismissal discards it. A changed base requires a fresh preview. Resume from the latest approved beat. Pause, next and back are immediate navigation controls.

The host can choose the agent’s role before a tour or switch during it. In **agent as presenter**, the agent follows the host’s objective, navigates within the approved site, waits for the observed page to appear, and explains it. In **agent as audience**, the human drives and explains. The agent watches the visible page, listens and asks relevant questions at a natural pause or when invited. The human retains navigation control. A role switch cancels queued speech and navigation, preserves the current page and return slide, and requires a fresh observation. The human host retains edit approval in either role. The audience display is a separate read-only projection in both modes.

## Agenda behavior the host can rely on

| Host says | Visible result | Effect on export |
|---|---|---|
| “After the numbers, demo this URL” during briefing | A host-requested tour appears immediately after the numbers slide. Review includes the URL and tour objective. | Source link can appear in notes. |
| “Skip this slide” mid-sentence | Narration stops, the agenda marks the slide skipped, and the next eligible item starts. | Slide remains in the deck. |
| “Skip this demo” or “skip the rest” | Skip the named tour or clarify the scope of “the rest.” An empty agenda offers Q&A or Finish. | No slide content changes. |
| “Go back to the skipped slide” | Deliberately revisit it. A completed revisit is recorded in session history. | No duplicate slide. |
| “What about annual plans?” | Hold position, answer with evidence or explain the gap. Offer a lookup if appropriate. | Add the answer only on request. |
| “Present this website now” | Insert a host-requested tour at the cursor, park the interrupted item, and return on Back. | No automatic new slide. |
| “Remove that slide from the final deck” | Show the proposed structural edit and apply on confirmation. Remap remaining agenda items. | A new deck revision excludes the slide. |

The first research-only acceptance test starts with a spoken or typed brief and ends with presentation.md. The live acceptance test starts independently from a saved, reviewed research run. It must work in a fresh browser session with an empty chat transcript.
