# Architecture · Interview, research and interruptible HTML presentation

The host first receives a verified `context.md` with source references and supported charts. The same project can turn that research into a reviewed HTML deck with private narration, interruptions and a resumable sentence cursor. The saved research and deck revisions can be reopened independently.

Implementation status and outstanding acceptance tests are tracked in the [current gap register](continuation-review.md#current-gap-register).

## Module 1 SaaS architecture

Module 1 delivers a private pitch studio. A customer signs in, opens a project, briefs the agent, approves research and receives grounded context they can reopen or download. Live delivery and guided walkthroughs extend that saved project in Modules 2 and 3. The diagram shows the Module 1 release target. [Module 1 acceptance contract](../handoffs/1-pitch-studio.contract.md)

```mermaid
flowchart LR
  Host["Next.js studio · chat, files, agent, player"] <-->|sign in, projects, turns, files| API["Express · identity and session controller"]
  Host <-->|interview audio over WebRTC after opt-in| Media["OpenAI Realtime interviewer"]
  API <-->|authenticated signaling and sideband actions| Media
  API <-->|scoped reads and writes| Store["SQLite and private artifact storage"]
  API -->|confirmed brief and job| Store
  Worker["Research worker"] <-->|lease, checkpoint, publish bundle| Store
  API <-->|interview and routing proposals| Model["OpenAI via Vercel AI SDK"]
  Worker <-->|approved research and synthesis| Model
  API -->|project-scoped context.md or SSE| View["React Markdown and Recharts viewer"]
```

| Customer action | Release contract |
|---|---|
| Sign in and open a project | Express resolves the account and its private workspace. List and create projects there. Each session belongs to a project. Check project access on every session, source, job, file and voice connection. A fresh browser resolves the project after sign-in and restores the saved transcript, attachments, job status and artifact versions. Sign-out ends access and audio capture. |
| Speak, attach files and review scope | Chat, attached files and generated files occupy the center of the desktop studio. The browser connects to the Realtime interviewer over WebRTC. The model asks one context-dependent question at a time and proposes updates through the authenticated session controller. Typed chat follows the same project history and action rules. |
| Approve research | Confirm the precise plan revision and permitted source scope. The microphone closes after the acknowledgement. A leased job reads approved pages and can run public search within the approved scope. It checkpoints independently of the browser. Reopening the project recovers the job or its committed outcome. |
| Select the finished file | The job publishes verified findings, evidence and a standalone `context.md` for the approved revision. When evidence is insufficient, it asks for a source or example. Module 2 derives its narration from the approved research. |

**Worker authority.** Derive workspace and project identity from the authenticated account. Carry those identifiers, the session and confirmed brief revision on the job lease and resulting artifact records. Scope every lookup by workspace and project. A worker can claim approved jobs, read their permitted sources and commit results against its current lease. A lost lease or superseded brief invalidates that commit. A scoped machine credential authorizes the worker. The customer's login credential stays at the HTTP boundary.

**Conversation authority.** The studio stores completed turns, scope facts, the open question and explicit language preference under the authenticated project. A structured proposal classifies the current turn. Express validates the requested decision, applies it against the current brief, and records the reply and effects in one transaction. Realtime partials can update the display without entering this transaction. [Studio cases and authority](studio-turns.md)

**Research coverage.** The model chooses web search or approved URL reads within a bounded pass. A second pass requires a material unanswered question and an eligible new target. The browser distinguishes total tool steps, distinct successfully read public pages and pass count. A focused portfolio or host-only request can finish with fewer sources than broad market research.

**Chart contract.** The context model proposes `<graph>` blocks containing `{name, description, type, data}`. Each bar or line point carries a label, finite value, unit, period and evidence ID. The worker checks comparable units and evidence, independently reviews candidates and publishes accepted blocks with the verified context. The authenticated endpoint returns the saved Markdown or replays verified text in SSE deltas. The viewer uses one incremental parser for both paths and renders the completed blocks with Recharts and a source table. [Chart service](../backend/src/services/research-graphs.ts) · [Viewer](../frontend/components/research/ContextArtifact.tsx)

**Persistence.** Accounts own projects in SQLite. A signed-in host can reopen saved context in a fresh browser. The session controller persists model proposals only after it validates their action and project state. Hosted, provider and physical-room evidence are tracked in the [acceptance handoff](../handoffs/1-pitch-studio.md).

**Release evidence.** Walk two accounts through the hosted service. Confirm that each can reopen its own project from a clean browser and that cross-account reads, writes and media connections are denied. Interrupt a spoken status reply during research, restart a worker, then open the resulting context and verify its chart against the cited source. Rehearse with real microphones and the selected provider in the supported languages. Exercise provider failure, retry, backup restoration and operator-visible job failures. Record the environment and observed results before calling the module released.

The [AWS operations guide](aws-operations.md) covers image digests, gateway routing, request and job latency queries, and restoring the project volume.

## Stack and trust boundaries

The [Module 2 HTML presentation plan](module-2-html-presentation.md) specifies slide templates, private narration, interruption handling and the host's revision decision.

| Component | Selected implementation | Authority |
|---|---|---|
| Host and audience | Next.js, React, TypeScript, Tailwind, shadcn/ui and TanStack Query. HTML/CSS slide templates and a host-owned player. | Host can approve a revision. Audience can acknowledge its assigned frame or slide. Only the host plays room audio. |
| Session controller | Express on Bun, Zod, SQLite on EBS, sequenced events and immutable deck revisions | Validates commands, manages the floor and agenda, records attempts and publishes public projections. Bun matches the existing SQLite implementation. |
| Text intelligence | OpenAI via Vercel AI SDK. Purpose-scoped model configurations, structured proposals, a stronger synthesis model when justified. | Proposes questions, findings, edits or target IDs from the permitted context. The controller owns execution. |
| Voice | Module 1 uses an OpenAI Realtime interviewer over WebRTC, with an Express sideband. Module 2 uses browser capture and playout with private Python OpenAI transcription and speech. | React owns the mic and playout. Express authorizes the durable action, active deck revision and current narration attempt. |
| Browser target | Isolated Chromium/Playwright worker, bounded read-only actions and approved origins | Reports observations and captures frames. The audience device acknowledges display. |
| AWS | ECS on EC2 behind Caddy HTTPS, encrypted EBS data, private worker services, Secrets Manager and CloudWatch. | Keep keys and private evidence on the server, authenticate workers and issue narrowly scoped audience access. |

```mermaid
flowchart TD
  Host["Host studio · chat, mic, files"] --> API["Express · account and project"]
  Host <-->|WebRTC speech and captions| Realtime["OpenAI Realtime interviewer"]
  Realtime <-->|final turns and action proposals| API
  API -->|approved brief revision| Worker["Leased research worker"]
  Worker <-->|native web search, synthesis and independent review| ResearchModel["OpenAI via Vercel AI SDK"]
  Worker <-->|eligible URL reads| Sources["Public page and PDF extractor"]
  Worker -->|atomic publish| Bundle["Saved context.md + verified findings + evidence IDs"]
  Bundle -->|authorized Markdown or SSE| Viewer["Private Markdown and Recharts viewer"]
  Bundle -->|same project and research ID| Plan["Audience and duration → slide and narration planner"]
  Plan -->|private review and explicit approval| Runtime["Live deck revision and sentence cursor"]
  Runtime -->|slide-only public projection| Stage["Host stage and separate audience page"]
  Stage -->|matching paint and heartbeat| Runtime
  Runtime <-->|transcribe final turn / synthesize approved attempt| Voice["Private Python voice adapter"]
  Runtime <-->|playout and interruption events / approve diff| Host
  Runtime --> Export["Standalone public HTML"]
```

### HTTP ownership

Express 5 owns the public HTTP boundary on Bun. Feature routers mount at `/api` and `/api/sessions`. Controllers validate inputs and translate service outcomes into JSON, Markdown, audio or server-sent events. SQLite repositories and leased jobs are independent of Express request lifetimes. The Python interview worker receives short-lived request data on the private network. Only the Express application receives host bearer credentials. Contract tests open a real local HTTP listener and send the same requests as the frontend.

## 1. Interview and research

1. Start privately. Spoken and typed input enter the same brief. Keep host words, inferred assumptions, private attachments, approved URLs and proposed public queries distinct. Learn the audience, requested decision, time, language, source scope and requested demonstrations as relevant. A precise prompt can go directly to review. For “pitch onboarding,” ask the one question most likely to change the search, such as whether the listener is a buyer choosing a pilot or an engineer choosing an integration.
2. Show the interpreted brief and public questions. A host answer patches the brief. Build confirms its exact version. Keep the foreground turn path available during research. “How far did you get?” reads job progress. “Only my files” narrows scope, invalidates dependent results and prevents new outbound searches. Keep one durable job key per session and confirmed brief. Renew leases and check the current revision before every dispatch and commit.
3. Ingest material with a locator, including the character range for pasted material, page for text PDFs, slide for PPTX and row range for CSV. The studio research worker uses `SessionRunner` and the shared Vercel AI SDK adapter. The agent chooses its next action from the approved goal and returned evidence. Its tools are native OpenAI web search for approved queries and URL reading for approved or discovered links. Search returns candidate links; only a successful source read adds public evidence. Files-only research skips network tools, and private material stays out of public queries.
4. Checkpoint each tool result, source and runner state in the leased job. A tool call and its result count as one step, including failed calls. Each pass permits up to 10 steps. The model may request one extra pass by naming a material gap, why it matters, and an unused eligible lookup that could resolve it. The server validates that request within the original approval and the job budget. Resume from the last committed result after a worker restart. The writer cites stored records and states material gaps. A separate fact-check reviews each claim against its cited evidence before publication.
5. Publish the immutable `context.md` and verified findings under the same research ID. The viewer replays verified text from the authenticated SSE endpoint, parses complete graph blocks and lets the host download the same Markdown revision. Internal host-note provenance remains in the private bundle. The research preview ends here and stays usable independently of a deck.
6. The host chooses **Prepare slides** in the same project. Express loads the verified bundle by research ID. The planner uses the audience, duration, findings and evidence to choose the slide order, templates, concise visible content and private narration. Independent review can keep a consecutive supported sequence or request one repair if all proposed beats fail. The controller assigns slide, beat and sentence IDs and persists a draft. The host sees the actual HTML, narration and sources in review, then explicitly approves the revision to present.

## 2. Presentation and intervention

| Moment | Immediate behavior | Durable effect |
|---|---|---|
| Start | Select an approved revision, create a host playback generation, render the first visual and obtain paint confirmation. Authorize one speech attempt with specific claim, text, asset and revision. | Save cursor and attempt. Public content is a projection. Private narration and transcripts stay with the host. |
| Host begins speaking | Duck or stop locally, pin the visible target and hold advancement. Capture continues. Talk provides an explicit ownership signal in a noisy room. | Record cutoff and whether playback was partial, complete or uncertain. Silence or a partial transcript cannot commit an edit. |
| Final turn arrives | Resolve a pending choice first, then interpret referents against the pinned slide, metric, filter, page or parked agenda item. Use one small-model proposal for natural language; explicit UI commands bypass inference. | Check host authority, expected revisions, generation and idempotency. A stale “yes” cannot approve a different proposal. |
| “Why did that number change?” | Retrieve the current and previous populations. Explain that four of twenty enterprise trials is 20%, while ten of one hundred overall is 10%. Cite the source and acknowledge unknown causes. | A completed answer returns to listening. Its playback never marks the interrupted slide complete. |
| “Actually fix that” | Ask what “that” refers to when ambiguous. For a specific correction show a private before/after of the affected visible highlight and narration. Keep the previous revision playable. | Approve once against the base revision, invalidate changed audio, repaint, then resume. Reject keeps the prior revision. Retain completed credit only for unchanged claims. |
| Continue, back, skip or reconnect | Consult point requirements, delivered claims, verified demo objectives, explicit skips and current dependencies. | Resume the earliest unfinished eligible point. Replay a partial claim at a safe sentence boundary. Reconnect paused; an explicit revisit gets a new attempt. |

Module 2 persists the deck revision, current sentence, playback attempt, private pending diff and stage sequence. The host browser stops audio locally on interruption and Express pins the sentence for the turn. A question can resume that sentence after the answer plays. A correction stays private until approved. Approval commits one revision and the corresponding slide must paint before narration of that revision can advance. The audience token serves the slide projection and matching paint acknowledgements. Offline HTML uses the same slide renderer and excludes the private narration and transcript. [Module 2 implementation and rehearsal](../handoffs/2-live-presentation.md)

Module 3 extends that cursor with explanation and demo requirements. A demo can satisfy a point that allows it, while a required limitation remains due until spoken. [Paired fixture and independent scoring](continuation-review.md)

## 3. Guided walkthrough · from utterance to webpage

For “show setup, but only if it doesn't need a login,” the router proposes a goal (“setup”), condition (“public access”), origin reference and return cursor. Resolve “this site” using the approved tour, the last host URL or a clarification. Browser execution has four distinct steps:

1. **Observe.** The worker returns the final origin, page title, named headings, links and controls, visibility and a fresh observation ID. Assign ephemeral target IDs to the observed candidates. Provide only a bounded relevant subset to the router. Treat page text as evidence, with no command authority.
2. **Resolve.** Exact accessible name and role win when unique. “Setup” may also refer to “Getting started” or “Quickstart.” For a semantic match, give the small model the goal, allowed actions and candidate IDs. It must select one of those IDs or ask, for example, “Account setup or SDK installation?” Resolve again if the DOM changes. Model-generated selectors, scripts and arbitrary URLs never enter the executor. [Playwright locators](https://playwright.dev/docs/locators)
3. **Act and verify.** During partial speech allow one expiring private prefetch to a known read-only destination. Final authorization permits one bounded navigation or scroll. Recheck origin, redirects, login condition, target text and meaningful visibility including overlay occlusion. Capture the same viewport as a frame tied to the observation. Timeout, changed target and login are explicit outcomes. “Actually skip it” fences the attempt and prevents its frame from reaching the stage.
4. **Project and continue.** Attach run, attempt, revision, epoch, observation and frame identity. Wait for the designated audience stage to decode and paint that frame, then allow narration of the observed content. A late frame after Back earns zero objective credit. In agent-as-presenter mode the agent may perform authorized navigation. In agent-as-audience mode the human drives; expose read-only observation and questions. Changing role cancels queued speech/actions and preserves the parked slide.

## 4. HTML quality is a release gate

HTML is the presentation deliverable. The deck schema holds slide IDs, layout, headline, short visible highlights, evidence references and private narration. React maps these fields to semantic markup with a small template registry. Author content as text; the model has no path to inject scripts, CSS or page-sized generated HTML. Choose layouts by information shape. A comparison needs comparable values and units, a claim needs one takeaway and support, and a conclusion needs a decision. Avoid copying the memo into slides. A long claim belongs in notes or on another slide.

The host preview, live stage and offline HTML should agree on revision, visual hierarchy and visible claims. Test actual browser rendering at a projector size, desktop and narrow phone. Require visible title and highlights, no horizontal clipping or colliding source/footer, readable type, working keyboard or link navigation, distinct states without color alone, and an offline file without network calls, secrets or private notes. Preserve approved words when resolving overflow through splitting, layout changes or private review. Capture representative screenshots and rehearse on the actual projector before declaring room readability. Native PPTX is outside the HTML release gate.

## 5. How the harness lowers cost

The harness is ordinary application code around model calls: contract validation, scoped context, permission checks, deterministic tools, a revision ledger, playback observations, browser proof and replay tests. A model can choose the intended operation; it cannot determine from its own text that the audience screen painted or that audio completed.

| Work | Cheapest suitable path | Escalation rule |
|---|---|---|
| Pause, next, resume, duplicate commands, math, status, HTML rendering | Local code and indexed state. Zero LLM calls. | Missing data becomes a gap or clarification. |
| Interview patch and final-turn routing | Small structured-output model, current state plus a few named candidates, bounded output. Start an evaluation with an account-supported mini model. | Repair an invalid proposal once. Ask the host on unresolved authority or ambiguous reference. |
| Public research and synthesis | Limit lookups per approved question, reuse unchanged evidence and completed bundles, use a model that actually supports the selected hosted tool. | Use a stronger model on a difficult evidence conflict or story-planning task only if the result can change the approved talk. |
| Live speech and demos | Synthesize short approved beats once; key assets by normalized text, language, voice and synthesis config. Synthesize new answers and changed beats on demand. Use visible DOM candidates before screenshots; keep at most one speculative fetch per turn. | Escalate a difficult grounded answer once, with a deadline and a logged reason. After timeout offer clarification, retry or a qualified answer. |

Order models by purpose and capability. Transport retry and semantic escalation are separate decisions. Log model ID, versioned rates, uncached/cached tokens, search calls, STT audio duration, TTS billable units, wasted preparation and EC2 allocation by run. Report preparation cost separately from the cost per successful live interaction. For illustration, at published GPT-5.4 mini text rates of $0.75/M uncached input and $4.50/M output, a 900-input/100-output-token routing call is about **$0.001125** before tools, voice and infrastructure. Twenty such calls cost about $0.0225 for routing alone. Measure total usage and latency on the actual account before changing defaults. [Model specifications and pricing](https://developers.openai.com/api/docs/models/gpt-5.4-mini)

## 6. What demonstrates the moat

Freeze the expected action, forbidden side effects, spoken status, demo status and next claim for 16 held-out traces across two speakers. Compare a well-prompted frontier baseline, a cheap model with the same simple loop, and the cheap model with controlled context and the ledger. Give each equal access to the underlying observations, evidence and tools. Repeat with speculative fetch on/off. The primary score requires both the right action and the right continuation. Also record false coverage, missed/false holds, public echo-only holds, acoustic stop latency, speech-end-to-paint, escalation and total cost per success. An HTTP fixture proves ordering; an actual laptop and audience device are required for acoustic and display claims.

Use the [voice protocol](voice-architecture.md), [12-hour release gates](plan.md) and [agent handoffs](orchestration.md) for implementation. Production AWS readiness requires an externally reachable hostname, working TLS and media, scoped credentials, real provider calls and a fresh-device rehearsal.
