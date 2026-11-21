# Audit 1 · Contradictions between docs, handoffs and code

Date: 2026-11-21 · Base: `715b534` + uncommitted working tree · Method: read every project doc, handoff, contract and AGENTS file, then checked each claim against the code (`grep`, file listing, SQLite schema, `bun test` → 144 pass / 0 fail).

Severity: **S1** misleads a judge or builder about what the product is · **S2** wrong about how it works · **S3** stale or cosmetic.

## The five that matter most

| # | Sev | Contradiction | Where the docs say it | What the code does | Resolve by |
|---|---|---|---|---|---|
| C1 | S1 | **What Module 1 delivers.** Half the docs promise a viewable, downloadable `context.md` with Recharts charts. The other half says "the deck is the deliverable". | Promises the viewer: `product.md:16`, `product.md:81`, `architecture.md:3,29,37,87`, `README.md:61`, `orchestration.md:7,15`, `plan.md:11`, `handoffs/1-pitch-studio.contract.md` AC-6, `handoffs/1-goal-driven-research.contract.md` AC-8. Says the deck is the deliverable: `product.md:26`, `presentation-flow.md:7`. | `ContextArtifact.tsx`, `ContextFileViewer.tsx`, `PitchDocument.tsx` and `PitchChart.tsx` were **deleted**. `hooks/research/use-context-artifact.ts` and `lib/context-artifact.ts` are orphaned, and `recharts` is an unused dependency. The backend still serves `context.md` (`controllers/context-markdown.ts`). | Decide once (see the recommendation below), then rewrite every listed line. |
| C2 | S1 | **Voice stack.** The docs say the OpenAI Realtime interviewer, or STT→TTS or Pipecat. | Realtime: `AGENTS.md:7`, `architecture.md:14,27,54,61`, `voice-architecture.md:3,13`, `studio-turns.md:9`, `README.md:55`, `orchestration.md:7`, `handoffs/1-interactive-studio.md:16`. Transcription with Python TTS: `handoffs/1-pitch-studio.md:13`, `continuation-review.md:12`. Pipecat, Deepgram or Cartesia: `continuation-review.md:43`, `voice-architecture.md:21,29,37`. | Module 1 uses the **OpenAI Live API, `gpt-live-1.1`** (`.env.example:16`, `voice/server.py`, `services/live-session.ts`). Pipecat is absent from `voice/pyproject.toml` and survives only in `voice/.venv`. Module 2 uses browser capture with Python `gpt-4o-mini-transcribe` + `gpt-4o-mini-tts`. | Rewrite `voice-architecture.md` around two paths (Live for the interview, cascade for presenting) and drop every Realtime and Pipecat sentence. |
| C3 | S1 | **The audience view exists, or it does not.** | Says it exists: `AGENTS.md:5` ("Next.js owns host and audience experiences"), `README.md:14`, `frontend/AGENTS.md:23-24,39`, `architecture.md:51,56,70,101`, `product.md:41-42`, `module-2-html-presentation.md:7,29,45`, `module-2-prd.md:66` (cites `controllers/audience.ts` + `LiveDeck.tsx`), `handoffs/1-project-accounts.md:34`, `handoffs/1-preview-rehearsal.md:39`. Module 3 (`product.md:18`) **requires** an audience display. | `frontend/app/audience/`, `AudienceStage.tsx`, `use-audience.ts` and `types/audience.ts` were deleted, and Handoff 2 AC-2 checks that `/audience` returns 404. Yet `backend/src/routes/audience.ts`, `controllers/audience.ts` and the `audience_tokens`/`audience_stages` tables are still live. | Decide whether presenting is single-screen (fullscreen presenter mode) or two-screen, then delete the dead backend routes or restore the page. Module 3 needs a decision either way. |
| C4 | S2 | **How research works.** | Fixed pipeline: `handoffs/1-interactive-studio.md:17` ("executes the reviewed public queries in one request… one shorter draft"), `studio-turns.md:30`. Agent: `architecture.md:85-86`, `handoffs/1-goal-driven-research.md:15`. | A goal-driven agent on `SessionRunner` (`services/research-agent.ts:6,238`). Budget: 10 lookups per pass, 2 passes, 150 s, 120k tokens, $0.35. | Delete or supersede `1-interactive-studio.md`, and update `studio-turns.md`. |
| C5 | S1 | **Module 1 status is reported four different ways.** Four handoffs cover the same contract (`1-pitch-studio`, `1-interactive-studio`, `1-preview-rehearsal`, `1-project-accounts`). | AC-5 is "verified/live" (`1-pitch-studio.md:26`), "unverified" (`1-preview-rehearsal.md:25`) and "verified/live" with different evidence (`1-interactive-studio.md:27`). `1-pitch-studio.md:18` says "Eight of ten release criteria", but the contract has **13** ACs and the table lists only 10. AC-5 in `1-goal-driven-research.md:26` is **failed** (28/29), while "Owner decisions pending: none". | — | Keep one live handoff per contract, mark the rest `superseded`, and re-run the 13 ACs. |

## Everything else

| # | Sev | Contradiction | Evidence |
|---|---|---|---|
| C6 | S2 | Slide layouts are 3, 4 or 9, depending on the doc. | `product.md:47` says "three default slide layouts". `module-2-html-presentation.md:15-22` lists four templates "using the existing headline, evidence and takeaway". `module-2-prd.md` R1.3 lists nine. The code has `TSlideLayout` = 3 **and** `TSlideTemplate` = 9 (`types/deck.ts:6,13-19`). PRD §6 `TSlideV2` does not exist; the code extends `TSlide` with `template`. |
| C7 | S2 | Charts are said to be "Recharts". | `architecture.md:21,37,67` ("React Markdown and Recharts viewer"). Slides use hand-rolled SVG and CSS bars (`SlideTemplate.tsx`, `ConversionChart.tsx`), and nothing imports Recharts. |
| C8 | S2 | Who picks the slide count, and with what inputs? | `plan.md:44` says the planner chooses it ("omit slide count… can produce more than five"). `presentation-flow.md:12` says the host enters a 1–12 ceiling. `README.md:83` says "Enter the audience and speaking time… a second audience or duration creates a separate saved pitch". The DB `decks.variant` is `["growth team",2]` (audience + count). |
| C9 | S2 | The Module 2 PRD contradicts itself on export. | §4 "Adopt" lists PPTX/PDF exporters, while R2.3 and §10 say HTML only and other formats are follow-ups. The owner called export "noise". |
| C10 | S2 | The Decisions API routing design is missing from the PRD. | The owner asked for the exact architecture and its benefit. `module-2-prd.md` §10.1 still says "a purpose-scoped OpenAI text model for proposals". The measured spike results (`scratchpad/decisions_spike.py`) are recorded nowhere. |
| C11 | S2 | Live state names differ. | PRD §7 lists `ready, narrating, listening, answering, proposing, awaiting_decision, applying, paused, completed`. The UI `LiveDeck.tsx:18-21` uses `paused, awaiting_paint, narrating, listening, answering, awaiting_decision, completed`. |
| C12 | S2 | The launch languages differ. | `voice-architecture.md:19` says English, Hindi and mixed English/Hindi first. `product.md:24` says English, Hindi, Telugu, mixed. The contract owner decision says "English/Hindi". The only measured multilingual success is Telugu (Live E2E). |
| C13 | S2 | The gap register is stale but linked as current from 5 docs. | `continuation-review.md:16-17` says Module 2 still needs "pending room choices… trusted audience paint", while `handoffs/2-live-presentation.md` marks 8/9 verified. The file also calls itself "pre-implementation review from baseline fcbe40d". |
| C14 | S3 | Broken anchors and links. | The source anchor `handoffs/1-goal-driven-research.contract.md:3` points to `product.md#first-deliverable--a-research-brief-you-can-present-from`, a section that was renamed. `architecture.md:37` links the deleted `ContextArtifact.tsx`. |
| C15 | S3 | `voice-architecture.md:5` says "the public presentation scaffold still uses native browser speech controls". | Module 2 now uses a Python STT/TTS adapter (`controllers/presentation-live.ts:76`). |
| C16 | S3 | `plan.md` is a "12-hour event" schedule with a CSV fixture, a demo URL and Module 3 in hour 4. | Linked as "release gates" from `architecture.md:137`; it no longer describes the work. |
| C17 | S3 | `architecture.md:131` quotes GPT-5.4 mini prices ($0.75/M in, $4.50/M out) as fact. | Not checked against the account's actual billing. Label it "illustrative, unverified" or measure it. |
| C18 | S3 | `frontend/AGENTS.md:3` says "the current voice chat is a scaffold". | `/chat` is a legacy page outside every module journey. |
| C19 | S3 | The architecture moat experiment (§6: 16 held-out traces, frontier vs small+controller) is presented as the plan. | It was never run, and no traces or labels exist in the repo. A judge reading it will ask for the numbers. |
| C20 | S3 | `module-2-prd.md:3-7`: "Status: implementation reference" with double blank lines. | — |
| C21 | S3 | `.env.example:17` defaults to voice `marin`, while the owner's `.env` uses `alloy`. | Not a contradiction, but the demo will sound different from the default. |

## Code that contradicts the product (not docs)

| # | Finding | Evidence |
|---|---|---|
| K1 | Public slides show internal evidence IDs ("Sources · P1, P3"). An audience cannot use "P1". | `Slide.tsx:30`. Screenshot of the render check. |
| K2 | The context viewer was deleted, but its data path still runs: the backend serves Markdown that no UI opens. | See C1. |
| K3 | The audience backend is live with no frontend: there are routes, tokens and tables for a page that 404s. That is unused attack surface. | See C3. |
| K4 | Module 1 AC-5 failed (portfolio coverage 28/29: an ML Projects entry lost its source title), yet the handoff header says nothing is pending. | `handoffs/1-goal-driven-research.md:26,32` |

## Recommendation for C1 (the decision everything hangs on)

Make **both** artifacts first-class and keep one shared source:

- **Research brief (`context.md`).** This is the Module 1 output. The host can read it, copy it and download it. It is the evidence a judge can audit.
- **Deck.** This is the Module 2 output, derived from that brief.

Deleting the viewer removed the only place where the product's grounding is *visible*. Grounding is the strongest claim the product makes, so a judge who can't open the cited brief has to take it on faith. Restore a read-only document view (see Audit 3 for the design) rather than resurrecting the old components.

## Cleanup order (docs only, about half a day)

1. Decide C1 and C3. These are owner decisions.
2. Rewrite `AGENTS.md:5,7`, `architecture.md`, `voice-architecture.md` and `README.md` to match the code: Live for the interview, cascade for presenting, an agentic research worker, and HTML + a brief.
3. Collapse the Module 1 handoffs into one and re-run its 13 ACs.
4. Mark `continuation-review.md` and `plan.md` as `historical` at the top, and remove their "current" links.
5. Fix the anchors and links (C14), add the Decisions API section to the PRD (C10), and remove the PPTX/PDF rows (C9).
