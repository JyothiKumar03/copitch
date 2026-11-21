# Build plan · 12 hours from kickoff

This is an optional event rehearsal schedule. Day-to-day implementation follows [the module build order](orchestration.md). The timeboxes below are for the integrated demo. Start AWS access and external media checks at kickoff. The first customer release is the private pitch studio.

Implementation status and outstanding acceptance tests are tracked in the [current gap register](continuation-review.md#current-gap-register).

## Module 1 customer release

Sign in, create a private project and start one voice session. Speak in each supported language, switch languages mid-conversation and interrupt an agent reply. Attach a source, approve its research scope and ask for progress aloud while the job runs. A microphone denial must leave the same flow available through text.

On desktop, find the agent on the right and the conversation and files in the center. Select the final `pitch.md`, open its private preview, inspect a chart and check its numbers against the cited evidence. Download the saved Markdown. Sign in from a fresh browser and reopen the project at the same result. Verify a second account cannot fetch the first account’s source, job status or artifact even with the resource ID.

Record results from real speech and a provider-backed research run, including recovery after a disconnect or worker restart. Verify account access, persistent storage and restore on the intended host before a SaaS release. Public deployment requires owner approval.

## Integrated event rehearsal

| Time | Work | Exit gate |
|---|---|---|
| 0–0:45 | Probe Pipecat ingress from the venue, one STT turn, one TTS asset, host cutoff, one audience frame and provider access. Freeze the paired setup fixture. | Hear and interrupt an identified clip. Trace a final turn to TypeScript exactly once. Record ICE/TURN failures. |
| 0:45–2:15 | Interview, one real source, notes, cited prose memo, structured findings, reviewed deck. | Files-only uses zero searches. A different audience changes the explanation. |
| 2:15–4:00 | Render HTML stage, prepare claim audio, persist coverage, paint and playout. | Interrupt B mid-sentence. A stale callback cannot skip C. Offline deck passes size and privacy checks. |
| 4:00–6:00 | Small router, pending questions, referents, conditional tour, one private prefetch. | Same instruction chooses different continuations on real setup vs login. Superseded fetch never appears. |
| 6:00–7:30 | Q&A, edit diff, skip/revisit, reconnect and HTML download. | Decline one edit, approve another, reopen that revision. Add CSV only if the critical loop passes. |
| 7:30–9:30 | Compare frontier/simple, small/simple and small/controller; compare prefetch on/off. | Save raw paired outcomes and cost by phase. Use development traces for fixes. |
| 9:30–10:30 | Verify deployed integration, media, persistence and audience projection. | Fresh host and audience tabs work on venue Wi-Fi. |
| 10:30–12:00 | Freeze features, run three rehearsals, save a backup demo and submission materials. | A second person chooses a branch and interrupts at a point of their choosing. |

## Build fixtures and expected outcomes

Use an event-authored one-page brief, a three-slide source PPTX, a site with two public headings, and a tiny CSV. For one month seed enterprise 4/20 and SMB 6/80. Overall conversion is 10%; enterprise is 20%. A second month with zero trials displays unavailable. Ask a sourced question, change the filter, double-interrupt, say “demo this URL,” request a missing heading, return and continue, finish, then reopen the HTML export. Assert the spoken and visible findings against these exact values.

## Deployment checklist and decisions under pressure

Run the Express API on Bun and the Next.js frontend behind HTTPS with an EBS-backed data directory. Use an existing controlled subdomain and TLS reverse proxy if ready. Configure provider key, session signing secret, data path and browser origin policy server-side. Install Chromium runtime dependencies during deployment and verify real browser launch. Check /api/health, mic permission, streamed events through the proxy, a real OpenAI call and writable storage. Restrict worker network egress before accepting arbitrary public URLs.

If full-duplex audio fails, isolate transport with push-to-talk and retain the same turn router; mark the degraded demo clearly. If live browser streaming stalls, refresh frames after each confirmed action and say what is available. If ingestion runs long, pin one supported text PDF and source deck before adding OCR. If export fails, preserve the committed revision and repair standalone HTML first. Record the working proof while event Wi-Fi is healthy. Keep architecture choices reviewable in the repo.

## Integrated presentation rehearsal from an empty session

Speak an unfamiliar public topic with no files; answer one follow-up; verify a real search invocation, cited evidence, a generated slide and a review stop. Start presenting on the public URL; interrupt, demo a site, return, export and reopen. Repeat in files-only mode and verify zero public search calls. Force a research timeout and verify the host can retry or proceed with explicitly limited coverage. Record passes and total trials; all targets are proposed until measured.

## Agentic planning acceptance gate

Run the same evidence bundle as a short founder pitch and a longer technical walkthrough. Omit slide count in both briefs. Verify the planner justifies the chosen structure, respects speaking and demo time, preserves source coverage and can produce more than five slides when warranted. No test should require longer talks to have more slides if extra time is better spent demonstrating. Repeat with an explicit host count and with a mid-talk time reduction. Confirm completed history survives replanning and the audience sees only the approved revision.
