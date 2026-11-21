# Equal AI presentation workspace

Read docs/product.md for user-visible behavior, docs/architecture.md for session contracts and docs/plan.md for fixtures and milestone gates. Follow the scoped AGENTS.md in the workspace you change. Use docs/orchestration.md to assign implementation work.

- Keep the existing workspace split. Next.js owns the host and audience experiences. Express owns API endpoints and session coordination. Bun manages workspace dependencies. Keep durable jobs independent of the HTTP response and live voice connection.
- Use TypeScript type aliases for application contracts, type-only imports and runtime validation at external boundaries. Give each feature a clear owner. Share wire contracts across workspaces when both consume them.
- Use OpenAI via Vercel AI SDK for text, with purpose-scoped model entries. Python owns the private OpenAI voice adapter. Use the OpenAI provider for text, voice and decision proposals. Build the shared multilingual streaming voice path with VAD from Module 1 onward. Keep host capture available during replies and background research until the host ends voice. The TypeScript controller owns routing and React owns playout. Ship HTML as the public deck format.
- The session controller owns durable changes. A model proposes actions. A host instruction, a research suggestion and content extracted from a file have distinct authority. Preserve provenance, revision and session identity across handoffs.
- Use stable slide, beat, evidence and agenda IDs. The host approves review before presentation. Keep private notes, research traces and intermediate drafts on the host channel.
- Release each module as a usable SaaS workflow through its UI and API. A signed-in customer must be able to open a private project in a fresh browser and retrieve the module’s saved output. Start with the host or audience action the user requested. Use existing checks where they help confirm the change, and report what the user can try. Dedicated QA work is on request.

Use snake_case for backend functions, methods and wire fields. Prefix application type aliases with T (for example TModelConfig). Frontend functions use camelCase. Preserve spelling required by external SDKs at the adapter boundary.

## Git workflow

- Keep each commit message at 200 characters or fewer. Start it with `feat:`, `fix:`, `refactor:`, `chore:`, `updater:`, or `release:`.
- Use `master` for releases and `dev` for integration. Name work branches `jk/<type>/<descriptive-name>` using one of the commit message types, for example `jk/feat/pitch-artifact`.
- Commit frequently in cohesive changes. Aim for 3–5 related files per commit. A focused change can be a single file. Include up to 10 files when the feature needs them in one commit.
