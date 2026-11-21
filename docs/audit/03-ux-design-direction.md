# Audit 3 · UI/UX: what is wrong today and what it should become

Date: 2026-11-21. Observed in Chrome at 1456×827 against the running app: the landing page, sign-in, an empty studio for a fresh test account, and six representative slides rendered through `/deck-render-check` with the production `PublicSlide` templates. Code read: `globals.css`, `cockpit.css`, `stage.css`, `ResearchWorkspace.tsx`, `DeckWorkspace.tsx`, `LiveDeck.tsx`, `Slide.tsx` and `SlideTemplate.tsx`.

## 1. Why it "looks like it's built of HTML"

| # | Observation | Cause in code | Effect |
|---|---|---|---|
| U1 | The whole product is one blush-pink surface (`#f6edeb`) with aubergine ink. The background, cards, chat bubbles and slides all sit within a few percent of the same lightness. | `globals.css` defines 3 paper tones and 1 accent, with no elevation scale and no neutral grey. | Nothing separates into layers, so it reads as a document, not a tool. |
| U2 | **Slides use about 30% of the canvas.** At 1280×720 the title, points and chart sit in the top third; the bottom 60% is empty. Body text is about 14 px on a 720 px slide. | `stage-style.ts`: content flows top-down with no vertical distribution, and the type scale was tuned for preview, not projection. | This is the most damaging visual. A judge sees "unfinished". |
| U3 | **Bar charts are a list of thin progress tracks** (2 px bars, values at the far right). Line and donut charts are 380×100 SVGs. | `SlideTemplate.tsx`: a hand-rolled `<dl>` with CSS tracks. | The data doesn't read from 3 m away, and there are no direct labels or highlighted takeaway. |
| U4 | Public slides show **"Sources · P1, P3"**. | `Slide.tsx:30` prints internal evidence IDs. | Meaningless to an audience, and it leaks implementation. |
| U5 | The studio is a large empty chat card next to a decorative orb. The orb shows "Ready when you are" and a "Spoken replies On" toggle, nothing else. | `VoiceInstrument.tsx`, `cockpit.css`. | The agent's actual work is invisible: what it heard, the language it detected, the intent it captured, what it's doing. |
| U6 | **No artifact surface.** The research brief viewer was deleted (Audit 1, C1). Research ends in a chat line plus a "Prepare slides" button. | `ResearchWorkspace.tsx:265,294` | The product's most defensible output, cited research, can't be seen. |
| U7 | The deck review and the live view are stacks of shadcn `Card`s, with buttons in rows: Previous, Next, Edit slide, Reorder, Download. | `DeckWorkspace.tsx`, `LiveDeck.tsx`. | It reads as an admin form. There is no filmstrip, no presenter view and no fullscreen mode. |
| U8 | Live mode shows status as a small badge ("Narrating"), and the current sentence as plain text in a side card. | `LiveDeck.tsx:73-79,155-161`. | Interruption, the system's best trick, has no visual moment. |
| U9 | The landing hero is a stock photo of a microphone next to the serif tagline "An AI presenter you brief by voice". | `LandingPage.tsx`. | It looks like a podcast template. It never shows the product. |
| U10 | The project header ("UI audit", email, Sign out) takes about 90 px above the workspace on every screen. | `ResearchWorkspace` page layout. | That vertical space should go to the conversation and the stage. |

What is already good and should be kept:

- the one-question-at-a-time voice flow;
- the private and public separation;
- keyboard navigation in live mode;
- the reduced-motion handling;
- the 44 px hit targets;
- the explicit text status for the mic and the job.

## 2. Design direction: "Studio": a dark instrument around light documents

The idea is that the **tool is dark and quiet, and the artifacts are light and loud**. It is the convention of serious creative tools (Linear, Pitch, Descript, Figma presentation mode). Chrome recedes; slides and documents are the brightest things on screen; one accent marks *live* state.

### 2.1 Palette (replace `globals.css` tokens)

| Token | Light (documents, review) | Dark (studio shell, live) | Use |
|---|---|---|---|
| `--canvas` | `#F7F7F5` | `#0E0F12` | App background |
| `--surface-1` | `#FFFFFF` | `#16181D` | Panels, cards |
| `--surface-2` | `#F0F0ED` | `#1E2128` | Inputs, hover, nested cards |
| `--line` | `#E3E3DE` | `#2A2E37` | Borders, 1 px |
| `--ink` | `#121316` | `#ECEDEF` | Primary text |
| `--ink-2` | `#5B5E66` | `#9A9EA8` | Secondary text |
| `--accent` | `#4F46E5` | `#7C83FF` | Primary action, focus, selection (indigo) |
| `--live` | `#E5484D` | `#FF6369` | Recording, live, interrupt; **only** for live state |
| `--evidence` | `#B7791F` | `#F5B544` | Citations, sources, verified marks (amber) |
| `--ok` | `#1F8A5B` | `#3DD68C` | Verified or completed |
| `--warn` | `#C2410C` | `#FF8B3D` | Gaps, needs input |

**Rules:**
- Indigo means "you can act".
- Red means "the microphone is open, or this is live". It never appears for errors (errors use `--warn` with an icon and text).
- Amber means "this came from a source". Every citation chip, source pill and verified number uses it, which makes grounding *visible as a colour*.

Plum and blush can survive as the **default slide theme**, so the brand continuity lives in the output, not in the chrome.

### 2.2 Type

| Role | Face | Size / weight |
|---|---|---|
| UI | **Geist Sans** (or Inter) | 13 / 14 / 16 px; 450 / 550 |
| Data, IDs, timestamps | **Geist Mono** | 12 px |
| Document headings (brief) | Newsreader (kept) | 28 / 20 px |
| Slide title | Geist Sans 650, tracking −0.02em | **56–64 px at 1280×720** |
| Slide body | Geist Sans 450 | **28–32 px**, at most 4 lines per point |
| Slide big number | Geist Sans 700, tabular | **120–160 px** |

### 2.3 Layout system

- An 8 px grid. Radii are 6 px (controls), 10 px (cards) and 14 px (stage).
- Elevation comes from surface steps plus a 1 px line, not shadows.
- The studio shell is three columns: **rail 240 px · work area flexible · inspector 360 px**. The rail and the inspector collapse below 1100 px; below 768 px everything stacks into one column, with the agent as a sticky bottom bar.

## 3. The flow, screen by screen

### 3.1 Studio (Module 1)

```
┌ rail ───────────┬ conversation ──────────────────────────┬ inspector ─────────────┐
│ ● copitch       │                                        │ AGENT  ● Listening  te │
│ Projects  ▾     │  [host]  nenu oka url ista...   te ▸en │ ─────────────────────  │
│ ─────────────── │  [agent] Got it — who will you         │ WHAT I UNDERSTOOD      │
│ ARTIFACTS       │          present this to?              │ Subject   Jyothi Kumar │
│ ◆ Brief  draft  │                                        │ Audience  ● missing    │
│ ◆ Research  ▣3  │  ┌ PLAN ─────────────────────────────┐ │ Outcome   Intro + hire │
│ ◆ context.md ✓  │  │ Subject · Audience · Outcome ·    │ │ Deliverable  6 slides  │
│ ◆ Deck v2       │  │ Deliverable   Sources: jk-ai.in   │ │ ─────────────────────  │
│                 │  │ [Start research]   heard ✓        │ │ LIVE TRANSCRIPT        │
│                 │  └───────────────────────────────────┘ │ …partial words…        │
│                 │  ┌ RESEARCH ▸ running  4/10 · 1 pass ┐ │                        │
│                 │  │ ✓ read jk-ai.in/about   3 facts   │ │ [■ End voice]          │
│                 │  │ ◌ search "KMIT Jyothi..."         │ │                        │
│                 │  └───────────────────────────────────┘ │                        │
│                 │  [ composer · 📎 · Web+files · 🎙 ]     │                        │
└─────────────────┴────────────────────────────────────────┴────────────────────────┘
```

- **The intent slots fill live in the inspector.** The four slots (subject, audience, outcome, deliverable) are *the* visible proof that the agent understood. Missing slots show in `--warn`, so the host sees what the agent will ask next.
- **Language chip on each turn** (`te`, `en`, `te ▸ en` when the reply language differs). This makes the multilingual claim visible.
- **Plan card** shows the 4 slots and the sources. A `heard ✓` tick appears when playback passed `spoken_until`, so the consent rule shows up in the UI.
- **Research card** is a live step list: tool, target, facts found, and a pass counter. It collapses to one line when finished.
- **Artifacts in the rail** are versioned objects: Brief, Research run, `context.md`, Deck vN. Clicking one opens it in the work area as a document, like a Claude artifact, with "Back to conversation".

### 3.2 Research brief artifact (restores C1)

- A reading view with a 720 px measure, Newsreader headings and Geist body text.
- Each cited sentence carries a small amber superscript chip. Hovering it shows the verbatim excerpt and the URL; clicking it opens the source.
- A **Facts** side table lists every number with its unit, period and source. Verified rows are ticked.
- A **Gaps** callout lists what was left out and why (from `keep_supported`).
- Actions: Copy, Download `.md`, **Prepare slides →**.

### 3.3 Deck review (Module 2 prepare)

```
┌ filmstrip ┬ stage (16:9, 75% width) ──────────────────┬ notes ─────────────────┐
│ ▣ 1       │                                          │ NARRATION  ~42 s       │
│ ▣ 2  ◆    │      Impact in numbers                   │ "Jyothi has processed  │
│ ▣ 3       │                                          │  more than thirty      │
│ ▣ 4  ⚠    │   30k+        8.98        4              │  thousand calls…"      │
│ ▣ 5       │   calls       GPA         products       │ ────────────────────── │
│ ▣ 6       │                                          │ SOURCES                │
│           │   Source: jk-ai.in/projects              │ ◆ jk-ai.in/projects    │
│ + slide   │                                          │   "30k+ calls..."  ✓   │
│           │                                          │ RENDER CHECK  ✓ pass 1 │
└───────────┴──────────────────────────────────────────┴────────────────────────┘
 [Edit]  [Reorder]  [Download HTML]                       [▶ Approve & present]
```

- The filmstrip marks problems: ◆ evidence-backed, ⚠ render-repaired.
- Total speaking time appears in the header.
- **Approve & present** is the single primary indigo action on the screen.

### 3.4 Live presenter view (Module 2 present)

```
┌──────────────────────────────── stage (fills) ───────────────────────────┬ next ──┐
│                                                                          │ ▣ 5    │
│        Call volume tripled in three quarters                             │        │
│        ████████████████████████████  30,000   Q3                         │ 02:14  │
│        ███████████████   17,000                Q2                         │ / 06:00│
│        ████████   9,000                        Q1                         │        │
│                                                                          │        │
├──────────────────────────────────────────────────────────────────────────┴────────┤
│ ● NARRATING  "Volume tripled in three quarters, from nine thousand…"  ▌karaoke     │
│ [◀] [❚❚] [▶]   🎙 mic on — speak to interrupt         [Ask privately…]   [F] Full │
└───────────────────────────────────────────────────────────────────────────────────┘
```

- **The interruption moment.** When the mic detects speech, the bottom bar turns `--live` red, shows "● Listening, paused at sentence 2", and live-transcribes the question. The answer arrives as a card with amber citation chips, then "Resuming at sentence 2…" counts down from 3, with Cancel.
- **The change proposal** slides in as a before/after panel over the right column. The audience stage dims slightly *only in the presenter view*, and the outcome is labelled clearly: "The audience still sees the original."
- **F** enters true fullscreen of the stage alone. This is the single-screen audience mode and resolves C3 without a second page.

### 3.5 Landing

- Replace the stock photo with **the product**: a 20-second muted loop of the presenter view being interrupted and answering with a citation, or a static composite of the screens above.
- Above the fold, use one line plus three proof chips: "Briefed by voice in any language", "Every fact cited", "Interruptible live".

## 4. Charts on slides (replace `SlideTemplate` charts)

| Rule | Now | Should be |
|---|---|---|
| Scale | 2 px track, values right-aligned at the edge | Bars 36–48 px thick, filling 70% of the slide width |
| Labels | A separate `<dt>` column | Direct labels: category on the left, value at the bar's end, 28 px |
| Emphasis | All bars the same plum | The takeaway bar in the accent colour, the rest neutral at 35% |
| Title | Generic ("Call volume grew each quarter") | Planner-written **insight titles** with the number in them ("Volume tripled: 9k → 30k") |
| Units and period | Tiny caption | Subtitle under the title: "Calls per quarter, 2025" |
| Source | "Sources · P1, P3" | "Source: jk-ai.in/projects" in amber, bottom left |
| Line | 380×100 SVG | Full-width, 4 px stroke, endpoint labels only, no gridlines except a baseline |
| Donut | Legend dots | Avoid for under 3 or over 5 parts; prefer a bar or a big number. Keep it only for part-of-whole with 2–4 slices |
| Big number | `metric_grid` at body size | 120–160 px number, 24 px label, at most 3 per slide |

Every chart stays generated from verified points. The change is in how they look, not in the data contract.

## 5. Interaction details that make it feel like a product

- **State is always visible.** The agent's state (Idle, Listening, Thinking, Researching, Speaking) appears in one place, the inspector header, with colour and text. It never depends on the orb animation alone.
- **Motion.** 150 ms ease-out for panels. A live waveform appears only when the mic is open. Skeleton shimmer for research steps. `prefers-reduced-motion` is respected (already wired).
- **Empty states teach.** The studio's empty state shows 3 example briefs as chips ("Introduce me to a hiring manager · jk-ai.in", "Brief a buyer on our pilot", "Summarise India's fish exports 2026"). Clicking one fills the composer.
- **Toasts only for background events** (research finished, deck ready). Inline messages handle everything else.
- **Keyboard.**
  - `⌘K` opens the command palette (new project, open artifact, prepare slides, present).
  - In live mode: `Space` pauses, `←/→` navigate, `F` goes fullscreen and `M` toggles the mic.
- **Accessibility kept.** Focus rings in the accent colour, at least 4.5:1 contrast everywhere (the dark tokens above are chosen for it), and status text alongside every colour.

## 6. Implementation footprint (for whoever builds it)

| Change | Files | Size |
|---|---|---|
| Tokens, fonts, dark shell | `globals.css`, `layout.tsx` | S |
| Three-column studio and artifact rail | `ResearchWorkspace.tsx`, a new `StudioRail.tsx`, a new `AgentInspector.tsx` | M |
| Intent slots and language chips | `AgentInspector.tsx`, `voice-preview.ts` (expose the language) | S |
| Brief artifact viewer (restore) | a new `BriefDocument.tsx`, reusing `use-context-artifact.ts` and `lib/context-artifact.ts` | M |
| Slide type scale, layout distribution, chart rewrite, source line | `stage-style.ts`, `SlideTemplate.tsx`, `Slide.tsx` | M |
| Filmstrip review | `DeckWorkspace.tsx`, `SlideOrder.tsx` | M |
| Presenter view, interrupt moment, fullscreen | `LiveDeck.tsx`, `stage.css` | M |
| Landing proof | `LandingPage.tsx` | S |

Note: `frontend/AGENTS.md:39` specifies the blush, aubergine and plum system. Adopting this direction is a product-behaviour change, so the owner must approve it and the AGENTS file must be updated in the same change.
