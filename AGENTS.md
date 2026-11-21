# Equal AI presentation workspace

Read docs/product.md for user-visible behavior, docs/architecture.md for session contracts and docs/plan.md for fixtures and milestone gates. Follow the scoped AGENTS.md in the workspace you change. Use docs/orchestration.md to assign implementation work.

- Keep the existing workspace split. Next.js owns the host and audience experiences. Hono owns API endpoints and session coordination. Bun manages workspace dependencies. Keep durable jobs independent of the HTTP response and live voice connection.
- Use TypeScript type aliases for application contracts, type-only imports and runtime validation at external boundaries. Give each feature a clear owner. Share wire contracts across workspaces when both consume them.
- Use OpenAI for text, voice and Decisions. Keep text-model configuration separate from voice transport and tentative decision events.
- The session controller owns durable changes. A model proposes actions. A host instruction, a research suggestion and content extracted from a file have distinct authority. Preserve provenance, revision and session identity across handoffs.
- Use stable slide, beat, evidence and agenda IDs. The host approves review before presentation. Keep private notes, research traces and intermediate drafts on the host channel.
- Run the affected workspace typecheck and lint, then verify the affected product gate with its fixture. For cross-workspace changes also run the root build. Report which gates actually ran and any missing credentials or hardware.

Use snake_case for backend functions, methods and wire fields. Prefix application type aliases with T (for example TModelConfig). Frontend functions use camelCase. Preserve spelling required by external SDKs at the adapter boundary.

## Git workflow

- Keep each commit message at 200 characters or fewer. Start it with `feat:`, `fix:`, `refactor:`, `chore:`, `updater:`, or `release:`.
- Use `master` for releases and `dev` for integration. Name work branches `jk/<type>/<descriptive-name>` using one of the commit message types, for example `jk/feat/pitch-artifact`.
- Commit frequently in cohesive changes. Aim for 3–5 related files per commit. A focused change can be a single file. Include up to 10 files when the feature needs them in one commit.
