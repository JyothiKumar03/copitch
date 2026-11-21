# Contract: Goal-driven research (module 1)
Owner decisions pending: none
Source: Module 1 contract at the time of implementation. See docs/orchestration.md for the current build order.

| ID | Actor action | Observable outcome | Check (entry point + exact command or click path) | Required evidence |
|----|--------------|--------------------|---------------------------------------------------|-------------------|
| AC-1 | Host approves a pitch plan with sources | The worker keeps the approved intent, chooses its tools, and requests a second pass only for a material gap with an eligible unused target. Each pass uses at most 10 tool steps | `bun test backend/tests/research-agent.test.ts backend/tests/studio-turn.test.ts` | fixture |
| AC-2 | Host limits research to their files | The agent uses supplied evidence and makes zero public lookup calls | Use a files-only approved brief with a public URL and a counting provider | fixture |
| AC-3 | Host reopens a project after a worker restart | The same job continues with saved collection and no repeat of completed lookups | Reclaim an expired worker lease and inspect the saved job and tool calls | fixture |
| AC-4 | Host supplies insufficient evidence | A usable partial brief includes explicit gaps, or the job asks for input without publishing unverified context | Run a bounded collection with missing facts and an invalid verification result | fixture |
| AC-5 | Host approves a pitch about the public portfolio | The downloaded brief passes the cited public-site coverage threshold | Run the portfolio coverage eval on the saved `context.md` for the approved site-only source | live |
| AC-6 | Host asks about India's fish exports in 2026 | The job finds official figures, distinguishes reporting periods and categories, and cites the standalone context, with a chart for verified comparable figures | Approve the market question in the studio. Compare downloaded `context.md` with the underlying government release or trade table | live |
| AC-7 | Host tells the agent about their own experience | The personal context uses the host's statements without displaying footnotes for them. The private evidence remains traceable | `bun simulations/studio/research_eval.ts` with the configured OpenAI provider and `bun test backend/tests/studio-turn.test.ts` for voice-note authority | live |

| AC-8 | Host opens a saved context document and inspects its sources | Download and SSE preserve the same Markdown and graph values, even across token splits. Distinct page counts are based on successful retrieval. A separate account cannot read either representation | `bun test backend/tests/context-markdown.test.ts frontend/lib/context-graphs.test.ts`; open the saved context in Chrome | fixture |

Out of scope: public deployment, presentation playback, voice transport
Invariants: exact approved brief revision, private sources, source-policy enforcement, traceable excerpts, independent verification, lease-fenced publication
