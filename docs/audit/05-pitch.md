# Audit 5 · The pitch: copitch, end to end

Written for a jury of AI engineers. Every claim maps to a measured result or is labelled as a target (Audit 2). Use it as the spoken script; the demo carries the weight.

## The one-liner

**copitch turns a spoken idea, in any language, into a cited research brief and a presentation that presents itself, and that you can interrupt.**

## 1. Problem (20 s)

Preparing a pitch is three jobs: working out what you want to say, finding the evidence, and building and delivering the slides. The AI tools available today do one of these, and they make facts up. Decks from generators look plausible and cite nothing. Voice assistants forget context when you switch language, and none of them lets you stop a presentation mid-sentence, ask "where's that number from?", and carry on.

## 2. Demo (3 min, live; the order matters)

1. **Brief by voice, in Telugu.** "Nenu oka URL ista, adi research chesi naapaina oka PPT chey, present cheyadaniki." The inspector fills in subject, audience, outcome and deliverable as you speak. Switch to English mid-way; the agent follows.
   *Shows:* multilingual hearing, intent capture, and the language chip on every turn.
2. **The plan and consent.** The agent reads the plan back, and the card shows **heard ✓**. Interrupt it with "yes" halfway: no job starts. Let it finish, say "go ahead": one job starts and the mic closes.
   *Shows:* the controller owns actions; the model only proposes.
3. **Research, live.** The steps appear one by one: read jk-ai.in/about, read /projects, search. The brief opens with amber citation chips; hover one and the verbatim source line appears. The Gaps box lists what was left out and why.
   *Shows:* an agent with a budget, verified excerpts and an independent checker.
4. **Deck.** Choose 6 slides. The filmstrip shows a render-check badge; every number links to its source.
   *Shows:* grounded planning, plus a headless render review with ≤3 repair passes.
5. **Present and interrupt.** Narration starts. Mid-sentence, ask: "Where did he study?" It stops in under 200 ms, answers "KMIT, GPA 8.98", shows the citation, and resumes **at the same sentence**. Then say "Add that he processed 30k+ calls." A private before/after appears; Apply; the slide updates on screen; it speaks the new line and moves on.
   *Shows:* sentence-level checkpoints, cited answers, typed patches and paint-gated advancement.

## 3. Why it's hard, and how we solved it (60 s)

| Hard problem | Our answer | Proof |
|---|---|---|
| Indic speech fragments and drifts script under turn-based voice | The Live API keeps whole utterances. We measured `gpt-realtime-2.1` splitting one Telugu sentence into 4 turns with the wrong script; `gpt-live-1.1` got it right | Spike scripts in the repo |
| Models fabricate citations | Every excerpt must match its passage verbatim (`quotes()`), an independent checker grades entailment, and unsupported lines are dropped *and disclosed* | Publication gates in tests |
| A voice "yes" is ambiguous | Consent needs three things: a proposal, playback past the end of the plan (timestamped), and an explicit start | `studio-turn.test.ts`, live AC-12 |
| Interruptions corrupt state | Every sentence is an attempt with an ID; stale callbacks are fenced; edits commit once against a base revision | `presentation-live.test.ts` |
| Long jobs die with the tab | Leased, checkpointed workers; reopen anywhere | Worker-restart fixture |

## 4. Architecture in one breath (20 s)

The model proposes; the controller decides. A browser over WebRTC talks to OpenAI Live. Express holds a sideband that records and checks every tool call. A leased research agent runs on the Vercel AI SDK. A deck planner sees only verified evidence, and Chromium checks its render. A live controller speaks approved sentences and accepts interruptions. One SQLite writer, four containers, ready for AWS.

## 5. Evals (30 s): say exactly this, no more

- 144 deterministic controller tests pass: consent, revisions, leases, fencing, ownership.
- Research recovered 28 of 29 reference facts from a real portfolio site. We report the one it missed.
- Barge-in stops playback in 161–191 ms in our fixture. The physical-room measurement is next.
- Next: labelled sets for word error by language, routing accuracy on 100 utterances, and human-calibrated entailment precision. Each will be reported with n and a confidence interval.

Do **not** claim "works in every language" or "never hallucinates". The audience will be AI engineers; under-claiming wins.

## 6. Why now and what's next (20 s)

- **Module 3, guided walkthrough.** Say "show them my live demo" and the agent opens the site, verifies the page painted, explains it, then returns to the slide.
- **Who buys:** founders, sales engineers and students who present weekly in a second language.
- **The moat** is the controller and its ledger, not the model: we can swap in a cheaper model and keep the guarantees.

## 7. Confidence check: what is real today

| Claim | Status |
|---|---|
| Voice brief in Telugu or English with intent slots | Works (one end-to-end Live run); the slot panel is a UI to build |
| Consent gating | Works, with tests |
| Agentic research with verified citations | Works; the brief viewer must be restored (Audit 1, C1) |
| Deck with render review | Works; the slides need the visual upgrade (Audit 3, U2–U4) |
| Live interrupt, answer and resume | Works in Chrome with providers; physical-room echo is untested |
| Edit with approval | Works |

The engineering is ahead of the presentation. The gap is visual (slides, studio, artifact view) and evidential (labelled evals), not architectural. That is fixable in days, not weeks.
