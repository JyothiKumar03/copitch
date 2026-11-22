# copitch

copitch helps a presenter turn a spoken or typed brief into a cited research memo, speaker notes and a pitch deck. The Next.js frontend and Express API share a Bun workspace.

## Requirements

- Bun >= 1.3
- Node >= 24 LTS (installed for tooling compatibility; runtime is Bun)
- Docker with Compose v2 (optional)

## Layout

```
frontend/   Next.js app for the host and the audience
backend/    TypeScript, Express 5 and SQLite on Bun
voice/      Private Python audio adapter for OpenAI interview turns
```

## Local development

```bash
cp .env.example .env
bun install
bun run dev          # web on :3000, api on :3001
```

Other commands: `bun run build`, `bun run typecheck`, `bun run lint`.

## Docker

```bash
bun run docker:up
# http://localhost:3000
bun run docker:down
```

The API image includes the Java reader for legacy PowerPoint uploads. For native development, use Compose to exercise `.ppt` ingestion, or set `COPITCH_PPT_READER` to a compatible local runtime directory containing `bin/java`, the compiled `classes/SlideText.class` and the Apache POI dependencies under `lib/`.

## Chat and long-running sessions

Set `OPENAI_API_KEY` and `OPENAI_TEXT_MODELS` in the backend process environment. The latter accepts a JSON array in fallback order. Replace the model placeholder with an ID available to your account. Omit temperature for models that require their own sampling defaults. The API readiness route checks SQLite. Verify provider access by starting an approved rehearsal with public or synthetic inputs.

```json
[
  {
    "provider": "openai",
    "model": "<your-model-id>",
    "max_output_tokens": 2048,
    "temperature": 0.4,
    "tool_providers": ["session"]
  }
]
```

The session tool provider maps to `find_context` (find a phrase) and `read_context` (read an excerpt). Set `tool_providers` to an empty array to disable tools for a model. For a budgeted Director mission, configure priced model candidates for `director` and all model-backed child purposes the mission uses, including `research` and `planning`. For model-guided Agent mode, configure a priced `browse` candidate with image input. Pricing uses `input`, `cached_input` and `output` in USD per million tokens plus a `version` label. A mission pauses when a required model or spending bound is missing. Agent mode can still capture public pages with the browser fallback and reports that coverage may be partial. The pitch studio uses the OpenAI Realtime interviewer over WebRTC. The private Python adapter negotiates the call and Express validates actions through the server sideband.

Session persistence uses Bun’s SQLite driver. For a legacy local development client, create a session with `POST /api/sessions` and keep the returned `session_id` and bearer `token` for the host. Send the token as a Bearer token to `POST /api/sessions/:session_id/runs` with a JSON body containing `message` and optional `context`. The response includes `run_id`. Subscribe to `GET /api/sessions/:session_id/runs/:run_id/events` with the same token. Supply `Last-Event-ID` when reconnecting. Cancel with `DELETE /api/sessions/:session_id/runs/:run_id`. Disconnecting the stream leaves the worker running. A backend restart preserves stored events and marks an unfinished run failed.

## Research workspace

Open `/research`, sign in and create or reopen a project. Speak or type what you want to pitch and who will be listening. Review the interpreted scope, public research permissions and proposed sources, then choose **Start research**. Open the finished `context.md` to read and download the verified reference document, citations and supported charts. This context can feed slide planning in the same project. The workflow requires a configured OpenAI model. Public research also requires Responses web search support. The worker chooses search or eligible page reads based on the approved purpose and keeps supporting evidence and limitations with the context.

## Spoken research interview

For Compose, set `VOICE_WORKER_TOKEN` to a generated secret shared by the API and Python worker. The local `dev:all` command generates an ephemeral worker credential if the variable is empty. Compose runs the worker on its private network. For development outside Docker, start the frontend, Express and the private audio service together from the repository root. The three processes inherit the root .env. Python 3.11+ and uv are required for voice.

```sh
bun run dev:all
```

Open a project and start voice or type in chat. Review the plan and approve it before research starts. The browser releases the microphone after the approval acknowledgement. Chat can show progress while the job runs. The downloadable Markdown, research job and compiled deck survive an API restart when the SQLite volume persists.

## Product and implementation

See the [host presentation flow](docs/presentation-flow.md) and [implementation workflow](docs/orchestration.md). Run `bun scripts/audit-presentation-gates.ts` to locate coverage gates and limits in the deck and research paths.

## AWS deployment

Follow the [AWS operations guide](docs/aws-operations.md) to build the four images, validate the stack, find a trace and rehearse recovery. The [CloudFormation template](deploy/stack.yml) provisions the managed ECS deployment. The gateway exposes HTTPS, the API and voice worker stay private, and encrypted EBS holds the SQLite database. CloudWatch records request and durable research timings. Verify the release using the [Module 1 acceptance contract](handoffs/1-pitch-studio.contract.md).

## HTML presentation and model selection

Open the research workspace, approve the research plan, and request a slide count by text, voice or the count control. OpenAI Decisions advises the manual preparation route, and the planner can follow up on evidence gaps within the approved source scope. If the exact count cannot pass independent checks, the private recovery view can offer fewer slides, a draft or a request for more sources. Review the saved slides and speaker notes, then approve the displayed revision to present or download the HTML. Slide edits produce private proposals. The offline HTML contains the approved slide content and public-facing source labels.

## Website walkthrough and PowerPoint

Open a private project and choose **Website walkthrough**. In **Agent mode**, give the browser a goal to explore. In **Page capture**, start a bounded capture of public pages. Both modes ask for a public starting URL, audience, goal and crawl depth. Depth 0 captures the starting page. Each additional level allows another link hop within the approved website. Review and approve the scope to start.

The job saves observed pages and screenshot evidence to the project. Review the captures and coverage, then open **Choose PowerPoint content**. Select each item you want to include, add any wording of your own, and confirm the slide plan. Selected screenshots include everything visible in their pixels. A fresh sign-in can retrieve the original confirmed export. An earlier full export, when present, remains available in the archive. The [acceptance contract](handoffs/3-website-to-powerpoint.contract.md) covers depth, selection, file validity and privacy.

Optional `purposes` on each `OPENAI_TEXT_MODELS` entry accepts `interview`, `research`, `planning`, `live`, `chat`, `director` and `browse`. A matching entry takes priority over generic entries. An entry without purposes can be considered for every purpose and still needs the capabilities and pricing required by that caller. The generic chat model-step service supports ordered transport fallback.

Run `bun run check:html` for the standalone HTML layout test and `bun run check:tour` for the offline browser/continuation fixture. Both use Playwright Chromium. Install it with `bunx playwright install chromium` or set `DECK_BROWSER_CHANNEL=chrome` to use installed Chrome.
