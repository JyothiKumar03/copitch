# RCA: speaking during live narration does not interrupt

Date: 2026-11-22.

**Symptom.** In live presentation, with the room microphone on, the presenter speaks while copitch is narrating. Nothing happens: the narration doesn't pause, and no answer or slide change appears.

## 1. Evidence

**Server trace for the owner's live session.** From the local dev log with `TRACE_LOGS=1`:

| Request | Count |
|---|---|
| `POST /decks/:id/live/commands` (pause, play, next) | 30 |
| `GET /decks/:id/live/audio/:attempt` (narration) | 13 |
| `POST /interview/transcribe` (room-mic utterance) | **0** |
| `POST /decks/:id/live/turns` (question or change) | **0** |

The microphone never produced a single utterance. The failure happens in the browser, before any network call: the speech detector (`RoomUtteranceGate`, `frontend/lib/room-utterance.ts`) never reported an onset.

**Reproduction harness.** I fed real recorded speech (macOS `say`) through the detector exactly as the audio worklet delivers it (20 ms frames at 48 kHz, mic plus speaker-reference channels). Narration echo came from a small-room impulse response (direct path plus 4 reflections). The host starts speaking 1.5 s into the narration. The harness reports the onset time after the host starts speaking. `MISSED` means it never fired. Reproduce with `cd simulations/voice/rca && bun sim.ts`. It compares the shipped detector (`gate-head.ts`) with the current `frontend/lib/room-utterance.ts`.

Voice level is the RMS of active speech at the mic. With `autoGainControl: false` (the current setting), normal speech at 50–80 cm into a laptop mic is typically about 0.01–0.03. This range is an estimate; the calibration step in §4 measures it per device.

| Scenario | 0.01 | 0.015 | 0.02 | 0.04 | 0.08 |
|---|---|---|---|---|---|
| Paused, quiet room (shipped HEAD) | MISSED | 780 ms | 120 ms | 80 ms | 60 ms |
| Narrating, headphones, no echo (HEAD) | MISSED | MISSED | MISSED | 1280 ms | 120 ms |
| Narrating, speakers, browser AEC removes 90% (HEAD) | MISSED | MISSED | MISSED | 1280 ms | 120 ms |
| Narrating, speakers, echo 0.05 (HEAD) | MISSED | MISSED | MISSED | 820 ms | 120 ms |
| Narrating, speaker reference not connected (HEAD) | MISSED | MISSED | MISSED | MISSED | MISSED |

While narration plays, the shipped detector hears only a raised voice (≥ 0.04) or shouting. Normal speaking volume is never detected, even with headphones and no echo at all. That matches the trace: zero utterances.

## 2. Root causes

| # | Cause | Where | Effect |
|---|---|---|---|
| **RC1 (primary)** | During narration the onset threshold is `max(0.034, noise × 4)` on the band-filtered level, and 6 of the last 9 frames must be voiced. With automatic gain control off, normal speech sits below 0.034. | `room-utterance.ts` `onsetThreshold`, `use-room-microphone.ts` `microphoneOptions` (`autoGainControl: false`) | The detector is deaf while copitch speaks, which is exactly when the presenter wants to interrupt. |
| **RC2 (design limit)** | Echo handling uses a 40-band, 2 kHz "fingerprint" and a single-tap-plus-one-reflection canceller. It can't model a real room. Lowering the threshold enough to hear normal speech makes loud laptop-speaker narration trigger itself (measured: with echo 0.10 a lower threshold fires on the narration at 6.7 s). | `residualVoice`, `echoOnly` | No single threshold works on both headphones and loud speakers. A threshold tweak alone can't fix this. |
| RC3 | If the narration element isn't routed into the worklet's reference input (the narration started in another audio context, or the connect failed silently), `hasReference` stays false. HEAD then discards all audio, and after 65 loud frames turns the mic off. GPT's in-progress edit instead lets echo through, which causes false onsets (measured: 1 false trigger per run). | `connectReference` (errors swallowed), `missingReference` | Either deaf or self-triggering, with no message to the presenter. |
| RC4 | Not realtime. After onset the detector waits 700 ms of silence. Then it uploads a WAV for batch transcription, then runs the live-turn model. Speech is also ignored in the gap between sentences, while the next narration clip loads (`playbackExpected && !playing`). | `use-room-microphone.ts`, `/interview/transcribe`, `live-turn.ts` | Even when it works, 2–6 s of dead air feels broken. |
| RC5 | No feedback. There's no mic level meter, no "heard you" state, and no calibration, so the presenter can't tell the mic is deaf. | `LiveDeck.tsx` | Failures look like the product ignoring them. |
| RC6 | No test. The detector had no audio regression test, and the feature was never run on a physical mic and speakers before it was called done. | process | The defect shipped undetected. |

## 3. What doesn't fix it

- **Only lowering the threshold:** that fixes headphones and moderate speakers, but loud speakers then self-trigger (RC2).
- **Only turning on `echoCancellation`:** it's already on. Browser echo cancellation for audio the page plays through an `<audio>` element or Web Audio isn't guaranteed on every platform. Treat it as a bonus, not a design dependency, until it's measured on the demo laptop.
- **Making the speaker reference optional** (GPT's current edit): it trades deafness for false triggers.

## 4. Fix, layered so the demo can't fail

**1. Hold to talk: the primary, deterministic path** (in progress by GPT stream S1).
- Hold Space, the on-screen button, or a presenter-clicker key (`PageDown` or `B`, configurable).
- Press pauses narration instantly (no detection); release sends.
- It works on any device, room or network, including over the cloud.

**2. Hands-free v2: duck, then confirm.** Errors become harmless instead of fatal.
- Use `autoGainControl: true`, keeping `echoCancellation` and `noiseSuppression` on.
- **Calibrate when the mic turns on:** 1.5 s of room silence, then 1.5 s of narration playing. That gives `noise` and `echo_floor`.
  - Onset threshold while narrating: `max(0.006, noise × 3, echo_floor × 2.5)`.
  - Otherwise: `max(0.006, noise × 3)`.
  - Require 4 of 9 voiced frames.
  - Simulated so far: a fixed variant, `max(0.009, noise × 3)` while the reference is connected, detected 0.015–0.08 voices in 40–120 ms with no echo-triggered onsets up to echo 0.05. It self-triggered at echo 0.10, which is why `echo_floor` calibration and duck-then-confirm are required. Re-run the harness on the calibrated formula before merging.
- **On onset during narration, duck instead of pausing:** narration volume drops to 20% within 100 ms and capture starts.
  - If the transcript matches the current narration sentence (token overlap ≥ 0.6), it was echo. Restore the volume and discard. This removes RC2's harm: a false trigger becomes a one-second volume dip.
  - Otherwise, pin the slide, pause, and submit the turn.
- **Missing reference:** show "Hands-free can't hear the narration output. Use Hold to talk or headphones." Use the calibrated threshold with duck-then-confirm, never the silent discard and never raw echo.
- Accept speech between sentences: treat `playbackExpected && !playing` as narrating, not as blocked.

**3. Realtime transcription** replaces the batch upload.
- Stream mic audio to an OpenAI Realtime transcription session over WebRTC. Signaling goes through the existing voice service `/connect`, as the interview already does, with server-side turn detection.
- Partial transcripts arrive about 300 ms after speech, and the echo match in step 2 runs on partials.
- End-of-turn comes from the server's VAD (about 500 ms), not a fixed 700 ms silence window.
- Keep the batch path as a fallback when WebRTC is blocked (some venue Wi-Fi blocks UDP).

**4. Visible state.**
- A live mic level meter in the control bar.
- States: *Mic ready · Hearing you · Thinking · Answer ready · Change ready to review*.
- A "Too quiet: move closer or use Hold to talk" hint after calibration when the measured speech level is below threshold.
- `?debug=voice` logs every onset, echo rejection and calibration value.

**5. Regression test.**
- Move the harness into `frontend/lib/room-utterance.audio.test.ts`, with three short committed WAV fixtures (host question, narration, silence; under 300 KB total).
- **The test fails the build if:**
  - speech at 0.015–0.08 isn't detected within 300 ms in the headphone, browser-AEC and 0.05-echo scenarios;
  - any echo-only onset happens at echo ≤ 0.05;
  - the missing-reference scenario self-triggers.

**6. Device acceptance.** Run this before anyone calls it done.
- **Setup:** MacBook speakers and built-in mic; headphones; external room speaker.
- **Test:** 10 interruptions each at normal speaking volume.
- **Pass:**
  - hands-free: ≥ 9 of 10 duck within 300 ms and answer within 3 s of the end of speech;
  - Hold to talk: 10 of 10;
  - no self-interruptions across a full 6-slide narration.
- **Run it twice:** on localhost and on the cloud URL.

## 5. Cloud-specific requirements

These apply to the AWS deployment in `docs/aws-deploy-runbook.md`.

- **HTTPS is mandatory.** `getUserMedia` and `AudioWorklet` only work in a secure context. Caddy obtains the certificate automatically on the EC2 host.
- **Same origin for the worklet.** `/voice/presentation-capture.js` is served by the web container behind the same hostname. Don't move it to a CDN on another origin.
- **WebRTC to OpenAI** needs outbound UDP from the presenter's network. Hold to talk and the batch fallback use only HTTPS, so the demo still works on locked-down Wi-Fi.
- **Region:** the browser talks to OpenAI directly for realtime audio. EC2 location only affects API hops. Choose `ap-south-1` (Mumbai) for an India audience.
