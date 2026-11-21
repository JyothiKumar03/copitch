# Build plan · Noon proof and six-to-seven-hour delivery

Use local IST. From the stated 10:07 start, noon is +1h53. Six hours ends at 16:07 and seven at 17:07. Target the research and preview proof by noon and a deployed, rehearsed build within the longer window. These are estimates for one builder. Event credentials, DNS and provider access are dependencies.

## Build priorities and release gates

| Priority | Deliverable | Pass condition |
|---|---|---|
| P0 · Research | Adaptive clarification, confirmed source scope, discovery or supplied-page reading, evidence, gaps and downloadable prose memo. Enable voice throughout the interview and during background research. | An ambiguous request elicits a material question. A precise brief reaches confirmation directly. Verify an actual cited page, a blocked URL, zero lookups in files-only mode, a mid-search correction and a memo readable without slides. |
| P1 · Prepare the talk | Select the highlights from the approved memo. Produce sparse visuals, audience-specific explanation, slide evidence links and private preview. | Each chart and spoken claim trace to the same source. The narration adds meaning or a qualification. An independent browser can open the saved talk. |
| P2 · Present and interact | Voice delivery, interruptions, grounded Q&A, basic lookups/calculations and private edit proposals. | Ask a question and keep the deck intact. Request an edit, reject it, then approve another. The audience sees only the committed revision. |
| P3 · Walk through the product | Agent presents a host-directed tour or acts as the audience for a human-led tour. | Switch roles mid-page. Stale audio or navigation cannot fire. The agent asks an observed, relevant question in audience mode. Back restores the slide and beat. |
| P4 · Export and rehearse | Pinned PPTX export, AWS HTTPS, recovery and live rehearsals. Provisioning checks begin with P0. | A fresh public session can complete research, presentation, both tour roles and export on the target room hardware. |

The elapsed estimates below are the original hackathon baseline. Use the gates above to order work and record observed results.

## Module boundaries

| Module | Location | Owns | Integration seam |
|---|---|---|---|
| Contracts | src/domain | Zod schemas, slide/beat IDs, commands | One fixture deck imported by every module |
| Session | src/server/session | Controller, SQLite, transactional command log and epochs | Snapshot, command and event API |
| Voice | src/client/voice | WebRTC, VAD events, response-purpose and cancellation | Completed turns in, authorized beats out |
| Stage | src/components/stage | React layout registry, chart, current surface | visualReady and frameReady |
| Planning | src/server/planning | AI SDK brief patches, outlines, typed drafts and intent routing | Validated domain objects |
| Research | src/server/research | Build public-safe queries, execute hosted search, resolve evidence, report conflicts and gaps | Versioned evidence bundle and cancellable job |
| Sources | src/server/sources | PDF pages, PPTX slides, CSV rows, URL headings | Anchored evidence and dataset IDs |
| Browser | src/server/browser | Session isolation, actions, observations and frames | open, inspect, scroll, close |
| Export | src/server/export | Generate PPTX for pinned revision | Same slide JSON as stage |
| Deployment | deploy and README | EC2, HTTPS, configuration, health and startup | Public URL plus reproducible launch |

## Research-first delivery order

Elapsed times are estimates from kickoff. Ship and validate M1 before building presentation playback. Start AWS access and HTTPS provisioning alongside M1. Noon is an early checkpoint, dependent on actual start time.

| Elapsed | Module and build boundary | Exit test |
|---|---|---|
| 0–75 min | M1 research. Brief input (typed fixture first), attachments, bounded real search, evidence records, metric validation, proposed actions and versioned research bundle. Generate presentation.md. | Download Markdown before any live session. Verify one external source, exact fixture arithmetic, one gap and a host-requested tour. Files-only mode makes zero external searches. |
| 75–115 min | M2 voice intake and deck preview. Merge spoken brief, accept corrections, have the planner derive a timed outline from M1 evidence, compile its slides and approve the agenda. | Reopen saved bundle with an empty transcript. Preview the selected slide count and separate planned demo action. |
| 115–185 min | M3 presenter. Stable agenda IDs, visible-target acknowledgment, narration beats, multilingual interruption, skip, explicit revisit and Q&A retrieval. | Skip slide 2 during speech. An old completion arrives and does nothing. Ask about its number, get a cited answer and resume slide 3. |
| 185–240 min | M4 live changes and browser. Atomic edit, working tour, displayed observation, voice redirect, return cursor. | Demonstrate one URL planned during research and one requested live. Check host/research origin, tour status and correct return position. |
| 240–305 min | M5 hardening and export. Context limits, state rehydration, AWS public entry, persisted data, PPTX revision pinning. | Force disconnect and low context budget. Reconnect paused with correct agenda, open export and compare figures with Markdown and latest edit. |
| 305–360 min | M6 rehearsal and submission. Real speaker tests, room audio, website outage and retry, repo and judging deck. | Three end-to-end rehearsals from empty project and one failure recovery. Report observed counts. |
| 360–420 min | Buffer for first failed gate. | Repair before optional template mapping. |

## Build fixtures and expected outcomes

Use an event-authored one-page brief, a three-slide source PPTX, a site with two public headings, and a tiny CSV. For one month seed enterprise 4/20 and SMB 6/80. Overall conversion is 10%; enterprise is 20%. A second month with zero trials displays unavailable. Ask a sourced question, change the filter, double-interrupt, say “demo this URL,” request a missing heading, return and continue, finish, then reopen the export. Assert the spoken and visible findings against these exact values.

## Deployment checklist and decisions under pressure

Run the Hono API on Bun and the Next.js frontend behind HTTPS with an EBS-backed data directory. Use an existing controlled subdomain and TLS reverse proxy if ready. Configure provider key, session signing secret, data path and browser origin policy server-side. Install Chromium runtime dependencies during deployment and verify real browser launch. Check /api/health, mic permission, streamed events through the proxy, a real OpenAI call and writable storage. Restrict worker network egress before accepting arbitrary public URLs.

If full-duplex audio fails, isolate transport with push-to-talk and retain the same turn router; mark the degraded demo clearly. If live browser streaming stalls, refresh frames after each confirmed action and say what is available. If ingestion runs long, pin one supported text PDF and source deck before adding OCR. If export fails, preserve the committed JSON version and prioritize the PPTX repair before template work. Record the working proof while event Wi-Fi is healthy. Keep architecture choices reviewable in the repo.

## Release gate from an empty session

Speak an unfamiliar public topic with no files; answer one follow-up; verify a real search invocation, cited evidence, a generated slide and a review stop. Start presenting on the public URL; interrupt, demo a site, return, export and reopen. Repeat in files-only mode and verify zero public search calls. Force a research timeout and verify the host can retry or proceed with explicitly limited coverage. Record passes and total trials; all targets are proposed until measured.

## Agentic planning acceptance gate

Run the same evidence bundle as a short founder pitch and a longer technical walkthrough. Omit slide count in both briefs. Verify the planner justifies the chosen structure, respects speaking and demo time, preserves source coverage and can produce more than five slides when warranted. No test should require longer talks to have more slides if extra time is better spent demonstrating. Repeat with an explicit host count and with a mid-talk time reduction. Confirm completed history survives replanning and the audience sees only the approved revision.
