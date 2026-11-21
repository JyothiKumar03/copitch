# Audit 6 · Why the Codex agents underperform

Files reviewed: `.codex/agents/development_agent.toml`, `product_agent.toml`, `instruction_writer.toml`. Today's bugs are the evidence. Every one shipped behind passing checks.

| # | Severity | File | Problem | How it showed up |
|---|---|---|---|---|
| A1 | Critical | development_agent.toml:20-21 | The finish line is "`check-handoff.ts` exits 0" plus green ACs. The agent optimises for paperwork and fixtures, not for what the host sees. | The Chrome acceptance passed while the slides had no charts and the narration read research hedges ("the evidence supports…"). |
| A2 | Critical | all three | Nothing tells the agent to inspect real output: read the saved `context.md`, look at rendered slides, read the narration script, check the job's activity log. | The research brief was one paragraph with no numbers, and nobody opened it. |
| A3 | Critical | development_agent.toml:5, 26 | "Do not widen scope" and "Do not write QA suites", with no root-cause method. The agent patches the symptom named in the contract. | The research agent got prompt tweaks while the causes sat elsewhere: one meta search, a 120-page PDF cap, a 4,096-token checker cap, a fallback that pasted research prose. |
| A4 | High | development_agent.toml:11, product_agent.toml:8 | READ FIRST points at docs that contradict the code (Realtime vs Live, a deleted `context.md` viewer, a deleted audience view, the stale gap register in `continuation-review.md`). See Audit 1. | Agents build against a product that no longer exists. |
| A5 | High | all three | No warning about silent degradation. Fallbacks, skips and caps hide failures. | The checker skip, the deck fallback, the PDF cap and the chart check all degraded silently to "something renders". |
| A6 | High | development_agent.toml:18 | Live checks are allowed to be "unverified" with a reason, with no pressure to reproduce on the real provider. | Model-output bugs (prompt quality, truncation, rejection loops) never surface under fixtures. |
| A7 | Medium | development_agent.toml:11 | "Use the installed poteto-mode workflow" is an external, unspecified dependency. | Behaviour varies by machine. |
| A8 | Medium | product_agent.toml | ACs describe mechanics ("paint acknowledgement 204") and never quality bars (numbers on slides, a presenter-voice script, charts for business decks). | Contracts pass while the product is poor. |
| A9 | Medium | instruction_writer.toml | It can only edit AGENTS.md. Nobody owns keeping the docs/ narrative true. | The contradictions accumulate (21 found). |
| A10 | Low | handoffs/ | Several handoffs cover the same contract with conflicting statuses. | AC-5 is verified in one handoff and unverified in another. |

## Fix

1. Add `senior_engineer.toml` (written alongside this report) for any bug, quality complaint or "it doesn't work". It owns diagnosis and the end-to-end fix, and it must show the user-visible output before and after.
2. In `development_agent.toml`, change the finish line to "the AC passes **and** the user-visible artifact meets its quality bar", and add the instruction to open the real output.
3. Fix the docs first (Audit 1), or point READ FIRST at `docs/audit/04-system-design.md`, which matches the code.
4. Add quality ACs to contracts: numbers present in the brief, at least one chart in a numeric business deck, narration free of research meta-language, slides advancing when narration ends.
