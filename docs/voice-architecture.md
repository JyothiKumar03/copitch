# Voice protocol · Private interview and public delivery

Module 1 uses OpenAI Live as the spoken interviewer. The browser connects over WebRTC after the host enables the microphone. Express authenticates signaling and opens a sideband on the same call. The controller validates actions against the private project, saved plan and host approval. Typed chat uses the same controller. [Sideband controller](../backend/src/controllers/live-call.ts)

The private audio worker transcribes completed turns and synthesizes approved presentation sentences. [Audio worker](../voice/server.py) · [Same-screen presentation](presentation-flow.md)

Use the [module handoffs](../handoffs) for observed acceptance outcomes.

## Transport and events

Start capture after the signed-in host enables voice and grants microphone permission. Keep the connection open through agent replies and scope confirmation. When research starts, finish the acknowledgement and close capture. The host can stop capture immediately or explicitly reopen voice. A denied microphone leaves the text conversation usable. Reconnect loads durable state with capture off.

Express keeps the provider key on the server and uses the provider call ID to bind sideband events to the authorized project. OpenAI manages speech detection and interruption. Use the proposal and originating turn IDs for playback and approval. An interrupted or unconfirmed readback cannot authorize a spoken start. The browser can always approve the current proposal explicitly. Media travels from the browser to OpenAI. [OpenAI Realtime WebRTC](https://developers.openai.com/api/docs/guides/realtime-webrtc) · [Server-side controls](https://developers.openai.com/api/docs/guides/realtime-server-controls)

The wire envelope carries session, producer incarnation, source sequence, turn, generation, revision and event ID. TypeScript assigns the durable commit order. Accept trusted worker observations, player events and stage acknowledgments only from their corresponding authenticated channels. A host command cannot impersonate them. Persist finalized transcript and decision separately. Resume after disconnect in a paused state.

## Input while the agent is speaking

Transcribe the host's original words and preserve mixed-language turns, source names, URLs and units. By default the agent follows the host's language. An explicit request for a reply or pitch in another language changes that output language. A language switch takes effect within the same voice session. Use the same intent and approval checks for speech and text in every supported language. English, Hindi and mixed English/Hindi speech are proposed first live acceptance cases. Published language coverage depends on that rehearsal.

An acoustic candidate can duck output immediately. It cannot change the deck, send a page to the audience or establish speaker identity. Pin the current referent and floor at onset. Replace the mutable transcript suffix on interim revisions. Retain each finalized segment and use endpointing or Talk release to propose a complete turn. On an unfinished “actually…” allow continuation; on a clear standalone stop stay paused. Handle repeated segment IDs, blank input, code-switching and late turns. A pending room question takes priority over the generic router. “Haan” may answer a yes/no question or acknowledge narration. If uncertain, hold and ask once. [Deepgram segment and endpoint semantics](https://developers.deepgram.com/docs/understand-endpointing-interim-results)

Use deterministic local controls for buttons. For natural language, pass the final turn, visible/parked target, current question and permitted commands to one small structured-action router. A partial may start one expiring read-only prefetch. A revised hypothesis cancels it. Stage changes and persistent edits require final authorization; content edits also need approval against the specified revision. The controller owns dependent work. Interrupting a status reply leaves the research job running.

## Output and coverage

Assign one utterance a purpose: interview, clarification, status, narration, answer or demo. Queue at most one foreground utterance and coalesce stale research updates. Pin speech to the approved words, claim, revision and source. Cache audio by text, language, voice and synthesis configuration; associate each scheduled playback with a fresh attempt ID. Only a narration attempt can satisfy the corresponding spoken claim. A finished answer leaves the agenda parked.

The host player records start, offset, last rendered position, device-output estimate, explicit cancellation and natural completion. Browser callbacks can fire after forced stop. Check attempt identity, generation, stop reason, uncertainty and expected revision before a complete mark. In ambiguous boundary cases replay the claim from a natural break. New audio for an edit may play only after stage paint. A worker synthesis-complete message is insufficient. Clearing a provider queue cannot retract sound the room already heard. [Web Audio API](https://www.w3.org/TR/webaudio/) · [Cartesia synthesis contexts](https://docs.cartesia.ai/api-reference/tts/working-with-web-sockets/context-flushing-and-flush-i-ds)

## Verification

For Module 1, start a project, switch languages and interrupt a spoken plan. Verify that a premature approval leaves the job unstarted. Approve the current plan, check that capture ends, then ask for progress in chat and reopen the saved pitch. Repeat with a denied mic, a disconnected media stream and another account attempting to open the session. Measure speech onset to audible cutoff and end of speech to first audible reply on a real device. Record languages, hardware, provider and observed timings with the release evidence.

Use the paired setup fixture in continuation-review.md, then rehearse with actual captured speech and acoustic loopback on the event laptop. Score false coverage, missed/false stop, incorrect next point, onset-to-audible-stop and final-turn-to-screen-paint. Separate model, media, rendering and network failures. Keep typed/manual controls when access or hardware fails.

Earlier synthetic tests remain reproducible with `python3 simulations/voice/control.py`. The previous provider-only completion model advanced too early in two of twenty modeled event orders. The earlier acoustic fixture activated on leaked narration at all four classic WebRTC VAD aggressiveness levels. These were fixture results, not measurements of Pipecat, Deepgram, Cartesia or human hearing. The cascaded worker and real device endpoints require a fresh rehearsal.
