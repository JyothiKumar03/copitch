# From the starter to the first presentation

The first milestone is a founder downloading a cited presentation.md from a confirmed brief. The next milestone starts in a fresh browser with the same saved research package. That break is intentional. It proves the product can remember findings, caveats and host decisions after chat history disappears. The subsequent planner chooses the slide order.

## Assignments and handoffs

Use one integration owner per milestone. Give each implementation agent the input fixture, directories it owns, expected output and exit test below. The existing frontend and backend workspace boundaries take precedence over the illustrative src/server and src/client paths in plan.md. Use its elapsed times as estimates from kickoff.

| Order | Coding agent and ownership | Deliverable to the next owner | Accept when |
|---|---|---|---|
| 1 | Session and contracts, backend | Versioned brief, source policy, research bundle, ordered agenda, snapshot and sequenced events. SQLite transactions cover command ID, expected revision, result and event. Publish a typed fixture for UI and worker development. | Repeating Build returns one job. Correcting the brief fences its previous result. Closing the host tab leaves the job running. |
| 2a | AI runtime and research, backend services | Reconstruct role-specific context, run bounded hosted search and attachment tools, keep a usage ledger. Persist structured bundle, indexed evidence and deterministic Markdown at one version. | With enterprise 4/20 and SMB 6/80, show 20% and 10% overall. Zero trials is unavailable. Resolve a citation to its passage, expose a gap, keep host-requested demo placement, and count zero searches in files-only mode. |
| 2b | Host UI, frontend, parallel with 2a against the fixture | Adaptive spoken or typed intake, confirmation, private job progress, source policy, gaps and download. Subscribe by session and replay from the last event sequence. | Type a brief, interrupt research with a correction, reload and download only the latest confirmed version. A timeout preserves partial evidence and offers retry or proceed. |
| 3 | Planner and stage, backend compiler plus frontend stage | From the saved bundle, select highlights and explanatory narration, then generate a timed outline, stable slide and beat IDs, separate tour item, review and approval. | Open with empty transcript. Compare a short pitch and a technical talk. Honor a requested slide count, show the rationale, and keep preview silent. |
| 4 | Live controller and voice, backend and frontend voice modules | One host audio owner, final-turn command routing, audience-safe event projection, paint and playback acknowledgments. | Interrupt slide 2, skip it, deliver a late audio completion, answer a cited question and resume slide 3 once. Preview a before/after edit, keep the original, then approve a new proposal against its base revision. Reconnect paused. |
| 5 | Browser and export, independently after the controller contract | Isolated browser observations and frames tied to the parked cursor. PPTX rendered from a pinned deck revision. | Open an approved site, narrate after the displayed frame, hand the tour to the human and switch to agent-as-audience questions. Return to the pinned beat, approve a chart filter and compare its points and editable text in the reopened export. |
| 6 | Integration and deployment | Persistent storage, HTTPS, real provider smoke test, recovery and rehearsal log. Start infrastructure checks alongside step 1. | Exercise the empty-project and files-only journeys and record observed outcomes. Use the validation table in architecture.md for acoustic trials. |

## One session through the model loop

1. Accept a confirmed turn, persist its session, revision, scope and job ID and return the job handle. A worker owns execution. Reconnecting clients subscribe to a snapshot and subsequent events.
2. Build each call from the confirmed brief and the current role. Research gets permitted sources and open questions. The presenter gets its visible beat, cursor and cited evidence. Retrieve excerpts by identifier and reserve room for output and tool results.
3. Pass that context, allowed tools, cancellation signal and an ordered array of eligible OpenAI model configurations to the AI service. Select only entries that support the required tools and output shape. Record the model actually used. Hosted search and realtime audio have their own capability checks.
4. Forward text deltas to the authorized subscriber. A step may contain both text and tool calls. Assemble the complete call, validate its arguments and permissions, then dispatch through the session controller. Persist the call ID and outcome, append the assistant call and matching tool result to context, then invoke the service again. A successful hosted search must carry evidence of a real lookup.
5. Check the revision, cancellation and remaining step, time and spend budgets before each dispatch and commit. Checkpoint completed steps. Reuse recorded tool results on recovery. Reconcile ambiguous external side effects before retry. Retry with another eligible OpenAI model only before visible output or tool effects for the attempted step. Save provider usage by attempt, mark missing prices unknown and report estimated cost separately from billed cost.
6. Validate final structured output before publishing a revision. A transient error may leave private partial text or evidence available for retry. Only a committed, reviewed deck may reach the audience. Hold live advancement until the correct visual and speech completion events arrive.

## OpenAI ownership

Use OpenAI for voice, the Decisions API and normal text chat. Probe voice and Decisions access with the event account before rehearsal. Map tentative Decisions signals to reversible interruption only. Route finalized host turns through the typed command path. Keep one owner for audio responses. If Decisions access is unavailable, surface the degraded mode and use the documented OpenAI Realtime and final-turn path.

## Extending the starter

The working loop lives in backend/src/services/session-runner.ts. The model adapter reads provider, model, output token limit, optional temperature and enabled tool providers from each entry in OPENAI_TEXT_MODELS. See the README for a complete entry.

For a new tool, put its definition, runtime argument schema and executor under backend/src/tools/. Bind the executor to authorized session data on the server. Register its bundle with the runner and add its provider name to the model configuration schema. Enable it on eligible model entries. Exercise a real SDK tool call with a scripted model, assert the correlated result reaches the next call, and repeat with that tool provider disabled. The existing session tools are read-only. A future tool that changes the deck or agenda must send a validated command through the controller and pass the revision and replay gates above.

When a stable engineering convention changes, delegate the scoped instruction update to the repository agent named `instruction_writer`. For example, ask it to update the backend AGENTS.md with an approved tool registration convention and verify the referenced code and commands.

## First implementation ticket

Give the session and research owners one typed brief, one CSV and one host-requested tour. Run the research worker without a microphone or audience tab. Have the frontend owner use the same fixture while the worker is built. Integrate as soon as the host can download the Markdown and reopen the exact bundle. Then introduce live audio against that saved fixture so a voice failure can be diagnosed independently of research.

## Bridging voice, research and presentation

The application session outlives a voice connection. The host browser owns capture, local ducking and one audio output. The voice adapter translates provider events. The Hono session controller owns the floor, permissions, commands and playback cursor. The research worker owns its job lease and evidence checkpoints. The audience subscribes to a sanitized stage projection. TanStack Query loads snapshots and tracks command mutations. A dedicated hook owns the WebRTC connection, tracks and event cleanup.

### Event ownership and cancellation

| Signal | Immediate action | Durable consequence |
|---|---|---|
| Speech onset or Talk pressed | Duck active playback locally, pin its beat and hold automatic advancement. Keep the mic open. | Research keeps its existing job and revision. |
| Partial transcript or Decisions yield | Show tentative host transcript. A matching yield can cancel the pinned response. Ignore results for superseded deltas. | Wait for a final authorized turn before changing a brief, deck, agenda or source scope. |
| End of speech | Wait for a correlated final transcript. Resolve missing or unintelligible input with Talk, repeat or typed controls. | A silence timeout cannot authorize Build, Present, Next or an edit. |
| Final transcript, typed command or button | Normalize into a turn with session, authority, input order and pinned target. Route a clear button command directly. | Controller validates the proposal against current state and commits once by command ID. |
| Research or tool completion | Check job identity, brief revision and current source policy. | Commit evidence and its event together. Superseded output stays out of the bundle. |
| Stage paint and playback completion | Match connection generation, response, purpose, beat and revision. | Normal narration completion may advance once. Q&A holds the floor, and a tour completion updates only its tour step. |

Use separate generations for voice connection/playback and for research scope. An interrupt cancels audio promptly. Only a material brief or permission change invalidates dependent jobs. Keep one foreground turn router available while the background research run occupies a worker. The starter's one-active-run constraint currently prevents using its existing run endpoint for both lanes concurrently. Introduce a dedicated turn/control endpoint and a separately keyed research job. Keep the uniqueness constraint for duplicate builds.

### Integration gates

1. Replay a mixed event trace against a deterministic controller with typed commands. Deliver duplicate finals, out-of-order decisions, canceled audio completion, old paint acknowledgments and a late search result. Assert exact revision, cursor, job and event counts.
2. On the event account and target laptop, test a WebRTC turn, interruption, normal playback completion and reconnection. Verify the chosen Realtime adapter, standalone Decisions and final-turn fallback against this trace. Verify the mic can hear the host during room-speaker playback.
3. During real research, ask for status while a lookup is in flight, correct the audience, then restrict to files. Verify responsive control, cancellation of obsolete work, source-policy enforcement at dispatch and commit, and a supported Markdown bundle with gaps.
4. Start a fresh host and audience from that bundle. Interrupt slide two, ask a sourced question, change a chart, open an approved demo, then return. Inject a stale completion at each transition. Only the displayed revision may speak.
5. Repeat with denied mic, shared-room noise, a second host tab, missing stage acknowledgment and a provider disconnect. Record audible stop latency, false sustained pauses, final-turn-to-commit latency, duplicate effects and stale advances separately. Use the sampling and acceptance targets in architecture.md.

For baseline Realtime, choose application-owned turn and interruption control for this prototype. Keep VAD enabled, disable automatic reply creation and automatic interruption, duck on onset and explicitly cancel or clear on confirmed yield. The adapter must reconcile provider playback that finishes during a provisional hold. If meaningful audio was inaudible, replay the pinned beat before advancing. Keep transport flags specific to their protocol. The selected architecture calls standalone Decisions with the turn ID and partial sequence held by Hono. See the [final voice architecture and simulation results](voice-architecture.md). See [Realtime conversations](https://developers.openai.com/api/docs/guides/realtime-conversations), [Realtime server events](https://developers.openai.com/api/reference/resources/realtime/server-events) and [OpenAI Decisions for voice](https://developers.openai.com/api/docs/guides/decisions-voice).
