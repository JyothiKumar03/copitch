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

Set `OPENAI_API_KEY` and `OPENAI_TEXT_MODELS` in the backend process environment. The latter accepts a JSON array in fallback order. Replace the model placeholder with an ID available to your account. Omit temperature for models that require their own sampling defaults.

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

The session tool provider maps to `find_context` (find a phrase) and `read_context` (read an excerpt). Set `tool_providers` to an empty array to disable tools for a model. Optional `pricing` accepts `input`, `cached_input` and `output` in USD per million tokens plus a `version` label. Attempts with insufficient pricing or usage report a null estimate. The pitch practice page at `/chat` posts to `/api/chat` and uses browser speech recognition and synthesis. The pitch studio uses WebRTC transcription and a private Python adapter for signaling and speech synthesis.

Session persistence uses Bun’s SQLite driver. For a legacy local development client, create a session with `POST /api/sessions` and keep the returned `session_id` and bearer `token` for the host. Send the token as a Bearer token to `POST /api/sessions/:session_id/runs` with a JSON body containing `message` and optional `context`. The response includes `run_id`. Subscribe to `GET /api/sessions/:session_id/runs/:run_id/events` with the same token. Supply `Last-Event-ID` when reconnecting. Cancel with `DELETE /api/sessions/:session_id/runs/:run_id`. Disconnecting the stream leaves the worker running. A backend restart preserves stored events and marks an unfinished run failed.

## Research workspace

Open `/research`, sign in or create an account, then create or reopen a project. Speak or type what you want to pitch and who will be listening. Review the interpreted scope and proposed searches, then choose **Start researching**. Select the finished `pitch.md` file to open the private viewer with an opening, talking points, closing ask and cited sources when supported. You can copy it before preparing any slides. Review the proposed public queries and supplied URLs before confirming. Download the resulting prose memo as `presentation.md`. The workflow requires an OpenAI API key and a configured text model that supports structured output. Public research also requires Responses web search support. The implementation uses OpenAI for discovery and citation-backed public findings. For a named URL the server requires a completed open or find action on that page plus a matching citation. Models without page-reading support can still return discovery results and an explicit gap for the requested URL.

## Spoken research interview

For Compose, set `VOICE_WORKER_TOKEN` to a generated secret shared by the API and Python worker. The local `dev:all` command generates an ephemeral worker credential if the variable is empty. Compose runs the worker on its private network. For development outside Docker, start the frontend, Express and the private audio service together from the repository root. The three processes inherit the root .env. Python 3.11+ and uv are required for voice.

```sh
bun run dev:all
```

Open a project and select **Start voice conversation**. Speak naturally, interrupt the agent, or ask for progress while research runs. The host can mute replies or choose to review each transcript before sending. Public search requires an approved brief and compatible OpenAI model. The downloadable Markdown, research job and compiled deck survive an API restart when the SQLite volume persists.

## Product and implementation

Start with [the orchestration plan](docs/orchestration.md) for work assignments and integration gates. See [product behavior](docs/product.md), [runtime contracts](docs/architecture.md) and [the rehearsal fixtures](docs/plan.md).

## AWS deployment

Follow the [AWS operations guide](docs/aws-operations.md) to build the four images, validate the stack, find a trace and rehearse recovery. The [CloudFormation template](deploy/stack.yml) provisions the managed ECS deployment. The gateway exposes HTTPS, the API and voice worker stay private, and encrypted EBS holds the SQLite database. CloudWatch records request and durable research timings. Verify the release using the [Module 1 acceptance contract](handoffs/1-pitch-studio.contract.md).

## HTML presentation and model selection

Open the research workspace, confirm a brief and generate the memo. Enter the audience and speaking time, then select Prepare slides. Review the chosen slides, estimated duration and speaker notes. A second audience or duration creates a separate saved pitch. Start the presentation explicitly or download the HTML. Slide edits produce private proposals. The offline HTML contains public slide content and source identifiers.

Optional `purposes` on each OPENAI_TEXT_MODELS entry accepts `interview`, `research`, `planning`, `live` and `chat`. A matching entry takes priority over generic entries. Entries scoped exclusively to other purposes are excluded. A single existing entry without purposes still works everywhere. Interview and research handlers select the first eligible entry; the generic chat model-step service supports ordered transport fallback. The deterministic deck compiler spends zero additional text-model tokens. The typed live router uses the same configuration contract.

Run `bun run check:html` for the standalone HTML layout test and `bun run check:tour` for the offline browser/continuation fixture. Both use Playwright Chromium. Install it with `bunx playwright install chromium` or set `DECK_BROWSER_CHANNEL=chrome` to use installed Chrome.
