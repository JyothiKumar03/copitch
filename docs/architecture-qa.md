# copitch: architecture Q&A

Each answer reflects the code and deployment as of 2026-11-22. Details: [module-workflows.md](module-workflows.md).

## Overall

**Q: What does copitch do?**
A: You describe a pitch by voice or text. It researches from approved sources, builds a cited slide deck, and presents it with narration that you can interrupt by voice.

**Q: What are the parts?**
A: A Next.js frontend, an Express API on Bun with SQLite, and a small Python voice service. Background workers handle research, slides, the Mission and the website agent.

**Q: Who decides what happens: the AI or the app?**
A: The app. Models only propose an action or write content. The server checks approval, revision, citations and budget before anything is saved, so a wrong model output can't change a deck or start paid work by itself.

**Q: Is Pipecat used?**
A: No. Speech-to-text, text-to-speech, voice detection and turn handling are our own TypeScript and browser code, calling OpenAI directly. It's simpler, with one fewer service to run and full control over interruptions.

## Connections

**Q: Why WebRTC?**
A: For voice. Audio goes straight from the browser to OpenAI, with low latency, built-in handling of poor networks and browser echo cancellation. No audio load reaches our server.

**Q: Why a WebSocket?**
A: For tool calls in the studio voice call. Our server attaches to the same OpenAI session and receives the model's action requests (save plan, start research). It checks each one before acting, and returns the result.

**Q: Isn't that two sessions?**
A: No. It's one OpenAI Live session. The browser joins it for audio, and the server attaches to it by session ID for control. The model runs once and the call is billed once.

**Q: Why not run the tools in the browser?**
A: Someone could fake an approval from the browser console, and the API key would be exposed. Server-side checks keep both safe.

**Q: Why not relay the audio through our server?**
A: It would add delay to every word, lower the audio quality, and add server load and code.

**Q: What does HTTP do?**
A: Everything else: typed chat, commands, uploads, narration clips, speech-to-text uploads and presentation turns.

**Q: Is there a WebSocket in the presentation?**
A: No. The presentation uses HTTP, plus polling every 650 ms for slide and sentence state. Hands-free listening adds a WebRTC connection to OpenAI for speech-to-text only.

**Q: What's the weak spot of this design?**
A: Two views of one call can drift out of step. A tool call once arrived before the host's words were transcribed, and a spoken plan change was dropped (fixed in `289e920`). Also, some venue Wi-Fi blocks WebRTC's UDP traffic.

## Module 1: interview, research, Mission

**Q: How does the studio voice call work?**
A: It's realtime speech-to-speech with OpenAI Live (`gpt-live-1.1`). For an action, Live hands off to `gpt-5.4-mini`, which calls a tool. The server checks the tool call and applies it.

**Q: How do we stop the agent from starting research without consent?**
A: Research starts only if the host's "yes" was spoken after the full plan, including slides, audience, budget and time, was read back.

**Q: How do we stop the agent from inventing a plan change?**
A: A change must come from words the host actually said before the tool call, on the current plan revision. Otherwise nothing changes, and the agent is told so.

**Q: What can the agent change on the plan card?**
A: Slide count, audience, purpose and tone. It can also add a fact the host said word for word, or restrict sources to the host's files. Every change creates a new revision that the host approves.

**Q: What can't it change?**
A: The subject. It also can't remove facts, add sources or change the time limit. The host does those with **Edit plan**.

**Q: How does a card edit reach the voice agent mid-call?**
A: The server sends the updated plan as quiet context (`session.thinking.append`), so the agent doesn't speak on receiving it.

**Q: How does research work?**
A: A research agent plans 3–10 questions, searches and reads approved sources, and records each answer with a verbatim excerpt. A writer drafts the findings. A grounding check removes anything unsupported, and a graph writer adds up to 3 graphs from exact numbers.

**Q: Why verbatim excerpts?**
A: So every fact on a slide can be traced to the exact source text. Each check compares quotes against stored passages.

**Q: What are the evidence IDs?**
A: `P#` public web, `H#` host's own words, `M#` pasted text, `F…` uploaded file, `B…` website capture.

**Q: What does "files only" mean?**
A: Research uses only the host's material. No web search runs.

**Q: What is the Mission?**
A: An approved outcome contract: subject, audience, purpose, slide count, required facts, sources, budget and time. A worker runs research, then slides, then checks the deck against the contract. When something is missing, it stops at **Needs you**.

**Q: How is the Mission budget enforced?**
A: Each AI call reserves its worst-case price before it runs. The limit is $5 per Mission. Real spend has been about $0.25–0.45.

**Q: Why can the budget fill up before real spend does?**
A: Each web search holds back about $0.10 for worst-case search content, because OpenAI doesn't itemize that cost. Those holds are never released.

## Module 2: deck and presentation

**Q: What is the Decisions API used for?**
A: An advisory check before planning slides. Given the requested count, intent, findings, gaps and passages, `gpt-6-luna` returns the probability that the evidence is enough, plus the largest gap: scope, breadth, measurements or context.

**Q: What happens with its answer?**
A: At 0.65 or above, planning starts. Below that, if public research is allowed, one bounded research round targets the gap. If the check is unavailable, planning still runs with all the other checks.

**Q: How does research become slides?**
A: The planner writes one "beat" per slide: title, up to 4 bullets, a layout, cited evidence IDs and 1–8 narration sentences, each with its own citations.

**Q: Why is slide count separate from research sections?**
A: The host asks for N slides. The deck must have exactly N, whatever the number of research sections.

**Q: Which layouts exist?**
A: Title card, bullets, metric grid, timeline, quote, comparison, bar, line and donut charts, and saved research graphs.

**Q: What stops made-up numbers?**
A: Every visible or spoken number must appear in that slide's cited passages, or the slide is dropped. A chart without quoted support is downgraded to a bullet slide.

**Q: What other slide checks run?**
A: Duplicate titles and takeaways, placeholder text, missing narration, unknown citations, reused graphs and empty slides. A failing slide is dropped or downgraded, and the rest of the deck survives.

**Q: Then what?**
A: An independent check verifies each slide's claims. A completion round fills any missing slides. Slides are rendered in Chromium and reviewed for layout, with at most 3 repair passes.

**Q: How are required host facts guaranteed?**
A: They're always passed to the planner and enforced as objectives. A deck without them doesn't pass.

**Q: How does narration play?**
A: One MP3 per sentence through text-to-speech (`gpt-4o-mini-tts`). The server waits until the audience screen confirms the slide is showing, then schedules the sentence, and the browser reports when it starts and ends.

**Q: Why one sentence per clip?**
A: So the host can interrupt at any sentence, and resuming continues from the exact sentence.

**Q: Why was narration slow, and what did we do?**
A: Each sentence took 1.3–1.7 s to generate, after the previous one ended. Now the next two sentences are generated in advance (cached by text), and playback runs at 1.2×. The model ignored "speak faster" instructions when measured.

**Q: How are late or stale callbacks handled?**
A: Every playback attempt has an ID and a revision. Reports from an older sentence or revision are rejected.

**Q: How does the host interrupt?**
A: Hold Space or B, or hold the button. Hands-free listens continuously. Typing works too. Each method pins the current slide and sentence.

**Q: Is the presentation realtime voice?**
A: No. It's speech-to-text → `gpt-5.4-mini` → text-to-speech. Hold to talk transcribes after release (about 1 s). Hands-free streams to realtime speech-to-text.

**Q: How does hands-free avoid hearing the narrator?**
A: Narration drops to 20% volume when speech starts. If the transcript matches the sentence being narrated, it's treated as echo and dropped. A fallback detector in the browser compares the mic with the narration audio.

**Q: What can the agent do with an interruption?**
A: It returns one of five outcomes:
- **answer**, cited;
- **clarify**, one question;
- **edit**, a proposed slide change;
- **control**, next, back, pause or go to a slide;
- **ignore**, noise.

**Q: Can the agent edit a slide live?**
A: Yes, as a proposal. The host sees a before/after view privately. The audience sees the change only after the host approves it.

**Q: Why do answers need sources?**
A: So the agent can't state unsupported facts in front of an audience.

**Q: What if the host states a fact?**
A: A statement from the host counts as host evidence. The agent acknowledges it and offers to add it to the slide. A question can't count as its own evidence.

**Q: How long does an interruption take?**
A: About 2.5–3 s from release to answer: about 1 s for speech-to-text and 1.6 s for the model.

**Q: Does Space work in fullscreen?**
A: Yes. Tap to pause or resume, hold to talk, and B talks immediately.

## Module 3: website walkthrough

**Q: What does the website agent do?**
A: It browses a public site toward a goal (Playwright plus `gpt-5.6-luna`), records screens with screenshots and facts, and saves coverage. The host picks steps for a PowerPoint, or attaches them as research.

**Q: How does it decide?**
A: It observes the page, the model proposes one action, the app's policy checks it, and the browser acts. When the model says the goal is met, a separate review must confirm it from the recorded facts.

**Q: What can't it do?**
A: Sign in, pay, submit forms or change the site. Those are blocked by policy. Sign-in with credentials isn't built.

**Q: How does it ensure coverage?**
A: At most 2 screens per page, then it moves on. It needs at least 4 distinct pages before claiming the goal, when more are reachable.

**Q: What does it cost?**
A: About $0.01–0.02 per run. The budget is $5.

**Q: Is the walkthrough voiced?**
A: No. Voice comes only when the captures are put into a deck and presented through Module 2.

## Models

**Q: Which models run where?**

| Job | Model |
| --- | --- |
| Mission decisions, website agent | `gpt-5.6-luna` |
| Everything else in text (chat, research, slides, live answers) | `gpt-5.4-mini` |
| Decisions API readiness | `gpt-6-luna`, fixed in code |
| Studio voice call | `gpt-live-1.1`, voice `marin` |
| Speech-to-text | `gpt-4o-mini-transcribe` |
| Narration and spoken answers | `gpt-4o-mini-tts`, voice `marin` |

**Q: Is there a reasoning budget?**
A: No reasoning level is set, so models run at OpenAI's default. Each call has a maximum-output-token limit, and reasoning tokens count against it. The website agent's limit was raised from 400 to 2000 after empty replies.

**Q: How do we change models?**
A: Set `OPENAI_TEXT_MODELS`, `OPENAI_LIVE_MODEL`, `OPENAI_TRANSCRIPTION_MODEL` or `OPENAI_SPEECH_MODEL` on the server. A new text model also needs its price added to `model-config.ts`.

**Q: What languages are supported?**
A: The voice call replies in the language the host speaks: English, Hindi, Telugu and mixed are handled and tested. Decks come out in English. Short spoken clips are sometimes transcribed in the wrong language.

## Deployment and operations

**Q: Where does it run?**
A: One EC2 m7i.xlarge (4 vCPU, 16 GB) in us-west-2, running four Docker containers behind Caddy HTTPS at https://32-188-91-207.sslip.io.

**Q: Why one machine?**
A: SQLite needs a single writer. One host is enough for a demo, and keeps deploys and debugging simple.

**Q: Why HTTPS?**
A: Browsers only allow the microphone on secure pages.

**Q: How do we deploy?**
A: Manually: push to master, then pull and rebuild on the server over SSH. Steps are in `deploy/DEPLOY.md`.

**Q: Where are the logs?**
A: In the server's persistent journal (`journalctl CONTAINER_NAME=app-api-1`). They survive restarts.

**Q: Where's the OpenAI key?**
A: Only in the server's `.env`, with owner-only permissions. It was sent over SSH without being printed, and it's never in git.

**Q: What's risky about hosting?**
A: The AWS account belongs to the event and will likely be deleted afterwards. There are no automatic backups, and SSH is open to the internet.

## Testing and gaps

**Q: How is it tested?**
A: 269 backend and 23 frontend tests, an audio regression test with recorded speech, an echo simulator, Chrome rehearsal scripts and production trace logs.

**Q: What hasn't been tested?**
A: Hands-free interruption with a real mic and speakers in a room. Hold to talk is the safe path for the demo.

**Q: What are the known gaps?**
A:
- The tone barely shows on slides.
- Decks are English only.
- Large decks (12 slides) can hit the 3-pass layout limit; 6–8 slides is safe.
- The website agent can't sign in.
- There's no live website demo during a presentation.
- Budget holds overstate spend.
