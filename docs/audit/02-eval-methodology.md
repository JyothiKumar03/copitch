# Audit 2 · Evaluation methodology: why each decision holds, and how we prove it

Date: 2026-11-21. Every number below is tagged **[measured]** (observed in this repo or session, with its source), **[claimed]** (asserted in a handoff, not re-run here) or **[target]** (a proposed bar, not yet met). A reviewer should be able to rerun every [measured] row.

## 0. The one-paragraph stance

copitch is a pipeline of five AI judgments:

1. hear the host;
2. understand the intent;
3. research and ground the content;
4. plan the slides;
5. route live interruptions.

Every judgment passes through a deterministic controller that owns all side effects. So we evaluate two separate things:

- **(a) the quality of each model judgment**, with a labelled set per stage;
- **(b) the safety of the controller**, with exhaustive deterministic tests. The model can be wrong; the controller must never let a wrong judgment become a wrong action without a host approval.

That separation is the core engineering argument, and the eval plan mirrors it.

## 1. The eval stack

| Layer | What it proves | Tooling in the repo | Status |
|---|---|---|---|
| L0 Contracts | Controller invariants: approvals, revisions, leases, fencing, ownership | `bun test` in `backend` | **[measured]** 144 pass / 0 fail / 985 assertions (this session) |
| L1 Component evals | Quality of each model judgment against gold labels | `simulations/studio/*_eval.ts`, `intent_to_pitch_eval.ts` | Partial: research coverage exists; intent, ASR and routing sets do not |
| L2 Journey evals | The right action **and** the right continuation, end to end in Chrome | `scripts/check-pitch-studio.ts`, `simulations/presentation/chrome-acceptance.mts` | **[claimed]** pass in the handoffs |
| L3 Physical rehearsal | Microphone, echo, room speakers, real latency | Manual, recorded | Open (Module 2 AC-9, Module 1 AC-3) |
| L4 Cost and latency | Cost per *successful* task, p50/p95 per stage | `ai-sdk.ts` usage records, `X-Trace-Id` | Recorded per call; never aggregated into a report |

**Rules that make these numbers trustworthy:**

- **Dev and held-out splits.** Tune prompts only on dev. Report on held-out, and freeze held-out labels before any tuning. Fixing failures against held-out labels turns them into dev data.
- **Confidence intervals.** Report n and a 95% Wilson interval for every rate. With n=20, "19/20 = 95%" really means 76–99%; say so.
- **Paired baselines.** Run the same items through (A) a frontier model with raw history, (B) a small model with raw history, and (C) a small model with controller state. Score them pairwise. If A ties C, report it.
- **Calibrated LLM judges.** Where an LLM grades (entailment, coverage), hand-label 50 items and report Cohen's κ between the judge and the human. A judge with κ < 0.6 is not a metric.
- **Joint scoring.** A trace passes only if *both* the action and the next state are right. Partial credit hides the failures that matter.
- **Failure catalogue.** Every failed trace gets a cause label: ASR, intent, retrieval, grounding, planning, routing, media or controller. The distribution tells us where to spend effort.

## 2. Stage by stage: the decision, why it is right, the metric, the edge cases

### 2.1 Hearing the host (Module 1 voice)

**Decision.** OpenAI Live API `gpt-live-1.1` over WebRTC, with an Express sideband. The model hears and speaks; Express records each exchange verbatim and checks every tool call.

**Why, with evidence.**
- `gpt-realtime-2.1` with `server_vad` split one Telugu sentence into **4 turns**, and per-fragment transcription garbled it into Kannada, Malayalam and Urdu script **[measured, `scratchpad/rt21_spike.py`]**. `gpt-live-1.1` transcribed the whole sentence correctly and replied in Telugu **[measured, `scratchpad/live_e2e.py`]**.
- Cascaded STT→LLM→TTS (Pipecat) adds two network hops per turn and needs explicit language selection. Live handles code-switching inside one session.
- The sideband keeps the key and all durable actions server-side. The browser data channel is limited to `allowed_client_events: []`.

**Metrics to report.**

| Metric | Definition | Target |
|---|---|---|
| WER (English) / CER (Indic) | On a labelled clip set per language (en, hi, te, romanized te, code-mixed) | **[target]** en WER ≤ 8%, Indic CER ≤ 12% |
| Entity accuracy | URLs, names, numbers exactly right (`jk-ai.in`, "30k+", "8.98") | **[target]** ≥ 95%, because a wrong URL breaks research |
| Reply-language match | Reply language equals the host's latest language, turn by turn | **[target]** ≥ 95% |
| Ordering invariant | Saved turns are sorted by host `start_ms`; no exchange is lost on flush | **[measured]** 8 tests in `live-interviewer.test.ts` |
| Backchannel discard | An agent fragment under 1500 ms, followed by host speech within 1500 ms, is not saved | **[measured]** unit test |

**Edge cases.**
- A language switch mid-sentence, and romanized Telugu typed in Latin script.
- A URL spoken as "jk dash ai dot in".
- The host talking over the readback of the plan.
- A silent microphone, or a denied microphone (the text path must stay usable).
- Two sessions in two tabs.
- Network loss during speech.
- The host saying "yes" to a plan that was interrupted before it finished.

### 2.2 Understanding intent

**Decision.** Four required slots: **subject, audience, outcome, deliverable**. The Live model proposes a plan through a strict Zod tool (`propose_research`), and the controller saves it only if it is valid. Research starts only when three things are true: a plan is proposed, the host **heard it** (the next host input starts after `spoken_until`), and an explicit start action arrives.

**Why.** Slots make intent measurable. Free-text intent can't be scored, but four slots can be scored for F1. The "heard" rule converts a social norm ("you can't agree to what you didn't hear") into a timestamp comparison, which is deterministic and testable.

**Metrics.**

| Metric | Definition | Target |
|---|---|---|
| Slot accuracy | Per slot, against gold labels for 30 scripted conversations (self-intro, buyer pitch, market brief, quarterly review; 4 languages) | **[target]** ≥ 90% per slot |
| Turns to plan | Host turns before a correct plan appears | **[target]** median ≤ 3 |
| Generic-query rate | Share of proposed queries that do not mention the subject | **[target]** 0% (the 42369e6e failure mode) |
| False start rate | A job started without a heard plan and an explicit approval | **Must be 0** (a safety metric, not a quality metric) |
| Consent recall | A clear spoken "yes, go ahead" after a heard plan does start the job | **[target]** ≥ 90% |

**Decisions API option.** Measured on 5 cases, the Decisions API scored a consent predicate at **1.0** for "Yes, go ahead" and **0.42** for "Yes, but change the audience". It picked the right reply language on all 5 cases (romanized Telugu → `te` at 1.0), with **0.1–0.9 s latency** **[measured, `scratchpad/decisions_spike.py`]**. That is a calibrated probability you can set a threshold on. A generative "is this consent?" call gives no such number. Five cases is a demo, not an eval: grow it to 100 labelled utterances before using it as a gate.

**Edge cases.**
- "Pitch about me" with no other information.
- A greeting in the middle of a session.
- A host question mistaken for a fact ("what should the audience do?").
- A changed audience after the plan was proposed (the plan must go stale).
- A URL that is a file name.
- A plan proposed in Telugu and approved in English.

### 2.3 Research and grounding

**Decision.** A goal-driven agent on `SessionRunner` (`services/research-agent.ts`):

- **Tools:** native web search and URL reading.
- **Budget:** 10 lookups per pass, 2 passes, 150 s, 120k tokens, $0.35 per job.
- **Second pass:** only for a named material gap with an unused, eligible target.

The writer must cite stored passages. `quotes()` checks every excerpt verbatim, after normalizing Unicode (NFKC), quotes, dashes and whitespace. An **independent checker** model then judges entailment, and `keep_supported` drops unsupported statements and records each one as a gap. The job is lease-fenced and checkpointed per tool result.

**Why each piece.**
- **Agent, not a fixed pipeline.** A portfolio needs 3 pages; a market brief needs about 10. A fixed query list either overspends or misses. The budget caps the downside.
- **Verbatim excerpt check.** It is cheap, deterministic and catches fabricated quotes at zero LLM cost. Before whitespace normalization, it falsely rejected "Prod Gain Jun" against "ProdGainJun" **[measured, fixed in `excerpt.ts`]**.
- **Independent checker.** A writer can't grade itself. An excerpt can exist and still not support the sentence; the docs say this outright ("an evidence ID verifies provenance, not entailment").
- **`keep_supported` instead of all-or-nothing.** One weak sentence used to discard a whole good brief. Now only that sentence goes, and it is disclosed as a gap.

**Metrics.**

| Metric | Definition | Current |
|---|---|---|
| Fact recall | Reference facts present in the brief (`portfolio_reference.ts`) | **[claimed]** 28/29 on jk-ai.in (AC-5 **failed**: one project title lost) |
| Citation validity | Every cited excerpt passes `quotes()` against its passage | Enforced: it is a publication gate |
| Entailment precision | Checker-accepted claims that a human also accepts | **Not measured.** Needs 50 human labels and κ |
| Unsupported-number rate | Numbers in the brief absent from cited evidence | **[target]** 0 |
| Files-only leakage | Outbound lookups when the host restricted research to their own files | **[claimed]** 0 (fixture) |
| Pages read, steps, passes, $ and s per job | From the job record | Recorded; report p50/p95 |

**Edge cases.**
- A bare domain that parks a JavaScript redirect (`jk-ai.in` → `www.`; fixed, with the www form tried first).
- A JavaScript-only site, which needs Playwright (deferred).
- Paywalled or 403 pages.
- Conflicting figures with different reporting periods (fish exports, AC-6).
- Mixed units (USD/EUR: the chart is withheld).
- HTML entities (`Bachelor&#x27;s`; fixed).
- An oversized evidence set, where the verifier used to skip silently above 48 KB; fixed so a skip now records its reason.
- A worker restart in the middle of a job.
- The host closing the tab.
- A host fact that has no public source, which stays attributed to the host.

### 2.4 Deck planning and rendering

**Decision.** The planner receives only the verified bundle and a slide ceiling. Every number on a slide must appear in a cited record. The deck renders through the same React templates as the host view, and a Playwright review checks overflow, collisions and readability, with at most **3 whole-deck passes**.

**Why.**
- Restricting the planner to verified input bounds hallucination at its source.
- One renderer for preview, live view, export and review removes "it looked fine in the preview" bugs.
- The pass cap bounds cost and latency.

**Metrics.**

| Metric | Definition | Current |
|---|---|---|
| Number fidelity | Slide numbers found in evidence | Gate (must be 100%) |
| Finding coverage | Material findings that reach a slide or the narration | **[target]** ≥ 80% at the requested ceiling |
| First-pass render rate | Decks clean on render 1 | Not reported; record it |
| Ceiling adherence | slides ≤ ceiling | **[claimed]** 1- and 2-slide plans (AC-1) |
| Human slide-quality score | 1–5 on clarity, hierarchy and readability from 3 m, from 3 raters | **Not measured.** The screenshots in Audit 3 suggest it would be low today |

**Edge cases.**
- One finding and a 12-slide ceiling (the planner should under-fill, not pad).
- 40 findings and a 3-slide ceiling.
- A chart with 1 point, or with negative values.
- Long names in Telugu script.
- A title longer than 72 characters.
- A legacy bundle with no structured findings.

### 2.5 Live presentation (Module 2)

**Decision.**
- Narration is approved text, spoken sentence by sentence; each sentence has an `attempt_id`.
- Speech onset stops the player locally and pins `{revision, slide, sentence}`.
- Each utterance is classified once.
- Edits are typed patches that the host previews and approves against a base revision.
- Narration advances only after a paint acknowledgement.

**Why.**
- Sentence-level attempts let the talk resume exactly where it was interrupted. `live-slides` replays the whole beat.
- Paint-gating means nothing is spoken about a slide the room can't see yet.
- Attempt IDs fence stale callbacks: a late "ended" event can't skip a slide.
- Typed patches stop instruction text from leaking into narration (a bug confirmed in `live-slides`).

**Metrics.**

| Metric | Definition | Current |
|---|---|---|
| Onset → audible stop | Mic onset to the player stopping | **[claimed]** 161 ms and 191 ms (fixture, recording plus echo) |
| Echo false-trigger rate | Interrupts during echo-only playback through real speakers | **Open** (AC-9, needs macOS mic permission) |
| Routing accuracy | Classification of question / change / navigation / approve / reject / backchannel / noise on a labelled set of ≥ 100 utterances in en, hi and te | **Not measured** (M2-6) |
| Answer citation validity | Every cited excerpt passes `quotes()` | Enforced |
| Resume correctness | The talk resumes at the pinned sentence after an answer | **[claimed]** AC-4 live |
| Stale-callback fencing | Old attempts can't advance the talk | **[measured]** `presentation-live.test.ts` |
| Question → first answer audio | End of speech to the first audible answer | Not measured; **[target]** p50 ≤ 2.5 s |

**Proposed routing design (owner asked for the exact architecture).** On each finished utterance, call `POST /v1/decisions` with `model: gpt-6-luna`.

- **Input:** the current slide, the current sentence, any pending proposal, the live state, the last agent line and the utterance.
- **Questions:**
  - a choice `intent` ∈ {question, change_request, navigation, approve, reject, backchannel, noise};
  - a choice `target_slide` over the deck's slide IDs;
  - a predicate `needs_clarification`.
- **Policy:**
  - act when `p(intent) ≥ τ_intent`, with τ = 0.9 for approve/reject (consequential) and 0.6 for questions and navigation;
  - otherwise ask one clarifying question;
  - a backchannel or noise resumes narration.
- **Downstream:**
  - a question becomes a cited answer (text model + `quotes()`);
  - a change request becomes a typed patch and a host review;
  - navigation and approve/reject go to the controller.

**Benefit.**
- Calibrated probabilities make the thresholds explicit and auditable.
- Latency is 0.1–0.9 s **[measured]**, against multi-second generative routing.
- Classification is separated from generation, so it can be scored on its own.
- The same predicate can replace Module 1's spoken-consent check.

**Cost.** One more provider dependency, plus one call per utterance.

**Edge cases.**
- "Haan" as an answer versus as a backchannel.
- "Go back to the education one" (a referent).
- "Actually skip it" while a change is pending.
- Two interruptions in a row.
- An answer interrupted halfway (the parked sentence must stay due).
- A stale "yes" to an older proposal.
- The stage disconnecting during apply.
- A mid-talk reload.
- A denied mic (the typed question path).

## 3. Cost per successful task (the number judges respect)

| Stage | Unit | How to compute |
|---|---|---|
| Interview | per completed plan | Live session minutes × rate + delegation tokens |
| Research | per published brief | Sum of attempt usage (`ai-sdk.ts` records the model and tokens per attempt), plus search calls |
| Deck | per approved deck | Planner + repair passes + checker |
| Live | per correctly handled interruption | STT seconds + router + answer + TTS characters |

Report **cost ÷ successes**, not cost ÷ attempts, because failed attempts are the real tax. None of these are aggregated today. The data exists in the SQLite attempt tables, so this is a ~100-line report script, not new instrumentation.

## 4. What to build next, in order (eval work only)

1. **Labelled sets** (about 1 day):
   - 30 intent conversations in 4 languages;
   - 100 live utterances;
   - 40 voice clips with entities;
   - 50 human-labelled entailment pairs.

   Store them in `simulations/eval-sets/` with a frozen held-out half.
2. **One runner** that prints a scorecard table (metric, n, value, 95% CI, target, pass) across all of them, plus the cost per success.
3. **The physical rehearsal** (Module 1 AC-3, Module 2 AC-9) with a recorded video, plus the onset-to-stop and question-to-answer timings.
4. **The paired baseline** (frontier raw versus small + controller) on the 100 live utterances. This is the experiment that justifies the architecture.

## 5. Honest current scorecard

| Claim a judge will test | Evidence today |
|---|---|
| "It understands me in Telugu" | One end-to-end Live run **[measured]**; no WER set |
| "It never starts research without consent" | Controller rule plus unit tests **[measured]**; no adversarial voice set |
| "Every fact is cited" | Publication gate **[measured in tests]**; entailment precision unmeasured |
| "It researches deeply" | 28/29 portfolio facts **[claimed]**, AC failed on one item |
| "You can interrupt it" | 161–191 ms in a fixture **[claimed]**; no physical-room run |
| "It routes questions correctly" | No labelled set |

The architecture holds up. The evidence is thin in exactly the places a strong AI-engineering judge will probe: voice accuracy by language, routing accuracy and entailment precision. Section 4 closes all three in about two days.
