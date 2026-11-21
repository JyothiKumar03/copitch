# Equal AI — Voice + UI starter

Bun workspaces with a Next.js frontend, a TypeScript Hono API, and Docker Compose.

## Requirements

- Bun >= 1.3
- Node >= 24 LTS (installed for tooling compatibility; runtime is Bun)
- Docker with Compose v2 (optional)

## Layout

```
frontend/   Next.js 16 app (Web Speech API voice input + speech synthesis output)
backend/    Hono API in TypeScript, served by Bun (Node fallback included)
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

The session tool provider maps to `find_context` (find a phrase) and `read_context` (read an excerpt). Set `tool_providers` to an empty array to disable tools for a model. Optional `pricing` accepts `input`, `cached_input` and `output` in USD per million tokens plus a `version` label. Attempts with insufficient pricing or usage report a null estimate. The starter UI posts to `/api/chat` and uses browser speech recognition and synthesis. OpenAI voice transport and Decisions integration are later milestones.

Session persistence uses Bun’s SQLite driver. For a streamed task, create a session with `POST /api/sessions` and keep the returned `session_id` and bearer `token` for the host. Send the token as a Bearer token to `POST /api/sessions/:session_id/runs` with a JSON body containing `message` and optional `context`. The response includes `run_id`. Subscribe to `GET /api/sessions/:session_id/runs/:run_id/events` with the same token. Supply `Last-Event-ID` when reconnecting. Cancel with `DELETE /api/sessions/:session_id/runs/:run_id`. Disconnecting the stream leaves the worker running. A backend restart preserves stored events and marks an unfinished run failed.

## Research workspace

Open `/research` in the frontend to scope a question, paste source material and choose whether public research is allowed. Review the proposed public queries and supplied URLs before confirming. Download the resulting prose memo as `presentation.md`. The workflow requires an OpenAI API key and a configured text model that supports structured output. Public research also requires Responses web search support. The implementation uses OpenAI for discovery and citation-backed public findings. For a named URL the server requires a completed open or find action on that page plus a matching citation. Models without page-reading support can still return discovery results and an explicit gap for the requested URL.

## Product and implementation

Start with [the orchestration plan](docs/orchestration.md) for work assignments and integration gates. See [product behavior](docs/product.md), [runtime contracts](docs/architecture.md) and [the rehearsal fixtures](docs/plan.md).

## AWS demo deployment

Use an EC2 Linux instance with Docker Compose v2 supporting `!reset`, a public DNS name pointing at its stable public address, inbound TCP 80/443 and a mounted EBS data directory. Copy the workspace to the instance. Set PUBLIC_HOST to the hostname, SESSION_DATA_DIR to an absolute directory on that mount, and configure OpenAI in the root .env. Generate DEMO_PASSWORD_HASH interactively with `docker run --rm -it caddy:2-alpine caddy hash-password`. Single-quote the hash in .env to preserve dollar signs. Give invited testers the demo password privately.

Run `docker compose -f docker-compose.yml -f deploy/compose.aws.yml up -d --build` from the repository root. The gateway obtains TLS, sends /api requests to Hono and serves Next.js at the same origin. The gateway protects the starter UI, chat and session creation with the demo login. Session-specific endpoints validate their own bearer token. When adding an audience projection, issue a separate read-only audience link. Keep future browser and worker services on the private container network.

Verify /api/health and the login from another network. From the public origin test typed chat, microphone permission, authenticated session creation, event delivery before run completion and reconnect. Restart the API and verify saved events remain readable. Record the hostname and observed results before marking the AWS deployment live.
