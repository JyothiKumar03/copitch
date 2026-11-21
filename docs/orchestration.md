# Module ownership and build order

The product agent describes the host or audience action, the evidence it needs, and what the user should see when it works. The coordinator assigns the Poteto development team the UI, API and voice work for that action. Each developer demonstrates their part through its normal entry point. The coordinator checks the integrated journey and reports fixture, live-provider and deployed results separately. The product agent returns any unresolved product, privacy or spending decision to the owner.

| Build order | UI ownership | API and worker ownership | What the user can do |
|---|---|---|---|
| 1. Private pitch studio | Signed-in projects, center chat and files, right-side agent, continuous multilingual conversation, selectable context artifact | Account-scoped project access, durable session and artifact revisions, OpenAI Realtime voice, leased research jobs and validated source-backed chart JSON | Brief the agent, approve research, ask for progress while it runs, open and download the cited context, then reopen the same revision after signing in again. |
| 2. Live presentation | Slide count, same-screen presentation, host controls, Q&A and private edit approval | Session controller, choice and referent tracking, playback and stage events | Review a grounded deck, interrupt, ask a question, approve a correction and continue from the right point. |
| 3. Guided walkthrough | Approve a site and goal, switch between agent presenter and agent audience, return to the deck | Restricted browser worker, target mapping, observed frames and conditional agenda updates | Guide a live page by voice, see the result and hand control back. |

## Module 1 build order and acceptance

1. **Workspace and access.** UI and API owners deliver sign-in, a private project list and durable reopen. Demonstrate the same saved project in a fresh browser and refusal when a different account requests its files.
2. **Conversation.** Voice, API and UI owners connect one host-controlled microphone and player to the session. Demonstrate an interruption, a language switch, a typed fallback and a spoken progress question during a running research job.
3. **Research and artifact.** API and UI owners turn an approved brief into a saved `context.md` file in the conversation. Demonstrate click-to-open preview, inspectable grounded Recharts data, and matching Markdown download. An unavailable source produces a visible gap.
4. **Release verification.** The coordinator follows the host from sign-in to reopen with a real microphone and configured providers. Exercise a dropped connection during research and confirm the job completes once. Record account isolation, backup restoration and the hosted journey before declaring the module released. Public deployment requires owner approval.

Module 2 reuses these account, project and voice boundaries to deliver an approved deck to an audience. Module 3 adds the guided browser and return to the saved presentation position. Each module retains the earlier customer journeys.

Use the [architecture](architecture.md) for data ownership, the [voice protocol](voice-architecture.md) for media behavior and the [gap register](continuation-review.md#current-gap-register) for implementation status. Preserve host approval, evidence provenance and the separation of private and public data at each handoff.
