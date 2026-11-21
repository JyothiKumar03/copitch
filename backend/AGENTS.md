# Backend

The current API runs Express under Bun. Use the existing app composition in src/app.ts for new endpoints. The starter POST /api/chat returns JSON. Preserve its contract for existing callers while adding the session APIs described in ../docs/architecture.md. Use feature routers in src/routes, native Express request handlers in src/controllers, shared authorization in src/middleware and data access in src/repositories. The HTTP tests start ephemeral loopback listeners. Start the full API on Bun to use the SQLite driver.

## Source layout

| Path under src/ | Responsibility |
| --- | --- |
| routes/ | Register paths, HTTP methods, middleware and controller bindings. |
| controllers/ | Parse and validate untrusted input, establish host or audience access, invoke a service, translate outcomes into HTTP responses or SSE. |
| types/ | Define application contracts with TypeScript type aliases. Use type-only imports and infer validated payload types from runtime schemas where appropriate. |
| services/ | Implement session, research, agenda, context selection, AI and export behavior in separate modules by responsibility. |
| repositories/ | Own SQLite queries, transactions, command deduplication, revisions and event ordering. |
| workers/ | Lease, resume and checkpoint durable jobs. |

Create folders as features land. Keep provider credentials, host notes and unpublished evidence server-side. Project only approved public fields onto audience events.

## AI SDK service and durable execution

- Give the Vercel AI SDK service one model step per invocation. Accept selected messages, allowed tools, an ordered array of provider/model candidates with capabilities, output limits and an abort signal. Return a normalized stream of text deltas, complete tool calls, finish reason, usage and errors. Keep SDK-specific objects in this module. Configure fallback explicitly and record the actual provider and model for every attempt. After visible output, surface interruption or resume from a checkpoint instead of silently replaying text.
- Use a SessionRunner class scoped to one authenticated session and run. Rehydrate it from SQLite. Select context per task from the current brief revision, source policy, cursor, agenda, evidence and recent turns. Reserve space for output and tool definitions. Preserve source IDs, metric denominators, host restrictions and unresolved clarifications during compaction. Use the budgets in the architecture document as starting values.
- The runner owns iteration. Stream permitted text deltas as they arrive. At step completion, preserve assistant messages including tool-call IDs. For each complete call, validate arguments, current authorization and revision, then dispatch the allowed tool and append its correlated result. Start another step with the updated context. A response may contain both text and calls. Finish on a terminal answer, cancellation, stale context, budget exhaustion or a recorded failure. Bound calls, elapsed time, tokens and estimated cost per run. Return partial research with explicit gaps when the budget runs out.
- Persist attempts and provider-reported usage once per attempt, including retries and failed or cancelled attempts when available. Track input, output and available cached or reasoning details according to the provider's billing model. Record the pricing version and currency for each estimate. Keep unknown usage distinguishable from zero and avoid adding overlapping token categories.
- Run long work in a leased worker independent of the HTTP connection. Checkpoint steps and tool results, renew the lease and fence stale workers at commit. Reuse recorded results by run, step and call identity. For external side effects use a stable idempotency key or reconcile an uncertain outcome before retry. On reconnect replay events by sequence or return a snapshot on a gap.
- The server controller owns mutations. Commit accepted commands with command ID, expected deck revision, agenda sequence and current epoch in one transaction with their emitted events. Reject superseded edits and playback callbacks. Research suggestions stay proposed until accepted. Files-only research skips network lookup. For the Module 1 streaming transport, authorize the voice session against the customer’s project. Reject access to another customer’s sessions, jobs, sources and artifacts at the API boundary. Each finalized authorized turn enters the TypeScript action path once. Only the host player can attest to its application playout.

## Verification

Run bun run lint, bun run typecheck and bun run build from backend/. For runner changes exercise a scripted model that emits text and two tool calls, then a final answer. Check correlated results, persisted cost and ordered replay. For recovery changes expire the lease between tool completion and next dispatch, interrupt a stale edit and reconnect to the paused snapshot. Confirm a repeated command changes the committed revision only once.

Use snake_case for backend functions, methods and wire fields. Prefix application type aliases with T (for example TModelConfig). Frontend functions use camelCase. Preserve spelling required by external SDKs at the adapter boundary.
