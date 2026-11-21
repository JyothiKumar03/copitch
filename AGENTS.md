# copitch presentation workspace

Use `docs/orchestration.md` to assign work. Open the affected route and inspect the owning controller, wire contract and saved artifacts before relying on dated audits or handoffs. Follow the scoped AGENTS.md in each workspace you change.

- Keep the existing workspace split. Next.js owns the host studio, deck review and same-screen presentation. Express owns API endpoints and session coordination. Bun manages workspace dependencies. Keep durable jobs independent of the HTTP response and live voice connection.
- Use TypeScript type aliases for application contracts, type-only imports and runtime validation at external boundaries. Give each feature a clear owner. Share wire contracts across workspaces when both consume them.
- Use OpenAI via Vercel AI SDK for text with purpose-scoped model entries. The multilingual interview uses OpenAI Live and a server sideband. Keep host capture available during replies. When the host approves research, close the microphone after the acknowledgement and offer a new voice session only on explicit request. The TypeScript controller owns approvals and durable actions. Ship HTML as the deck format.
- The session controller owns durable changes. A model proposes actions. A host instruction, a research suggestion and content extracted from a file have distinct authority. Preserve provenance, revision and session identity across handoffs.
- Use stable slide, beat, evidence and agenda IDs. The host approves review before presentation. Keep private notes, research traces and intermediate drafts on the host channel.
- Release each module as a usable SaaS workflow through its UI and API. A signed-in customer must be able to open a private project in a fresh browser and retrieve the module’s saved output. Start with the host or audience action the user requested. Use existing checks where they help confirm the change, and report what the user can try. Additional QA beyond module acceptance is on request.

Use snake_case for backend functions, methods and wire fields. Prefix application type aliases with T (for example TModelConfig). Frontend functions use camelCase. Preserve spelling required by external SDKs at the adapter boundary.

Write standalone JavaScript and TypeScript functions as const arrow expressions, including hooks, controllers, components, helpers and tests. Use `export const prepare_pitch = async (...) => { ... }` for a named export. For a required default export, declare the named const and then `export default Component`. Keep class methods, generators and external declaration signatures in the syntax their semantics require. Define bindings before first execution. Python functions use `def` or `async def`.

## Working agreement

The product agent owns user intent and acceptance criteria. The coordinator assigns implementation by workspace and calls the senior engineer for a bug or quality complaint. Use existing visual assets, React components and browser screenshots. Do not generate new imagery. Keep provider keys and .env private and use the already configured app for live checks. Ask the owner before public deployment, destructive actions, or consequential changes to cost, privacy or product behavior.

## Project update format

Use these four sections, in order, for implementation updates and handoffs in this project.

1. **Frontend done** lists user-facing features now available.
2. **Backend done** lists implemented API, voice, research and persistence behavior.
3. **Current module coverage** traces the user journey, names the evidence for verified steps, and lists remaining gaps. Use the current module number in the heading.
4. **Next module plan** gives the next module’s build order and the user-visible outcome that will demonstrate it works.

Keep updates brief. Label fixture results, live-provider checks and deployed behavior separately when that distinction matters.

## Git workflow

- Keep each commit message at 200 characters or fewer. Start it with `feat:`, `fix:`, `refactor:`, `chore:`, `updater:`, or `release:`.
- Use `master` for releases and `dev` for integration. Name work branches `jk/<type>/<descriptive-name>` using one of the commit message types, for example `jk/feat/pitch-artifact`.
- Commit frequently in cohesive changes. Aim for 3–5 related files per commit. A focused change can be a single file. Include up to 10 files when the feature needs them in one commit.

## Module acceptance

- **Product completeness.** Before implementation, the product agent names the customer's starting action, required decisions and usable output in the acceptance contract. Define how a returning customer can verify that the output matches the revision they saved.
- **Technical edge cases and iteration.** The developer identifies failures that can change the customer's result, such as a dropped connection or a repeated submission. Exercise those paths in the running app and record the observed outcome. After a fix, repeat the failed action and confirm recovery.
- **Artifact quality.** Open the saved research, rendered deck and narration when the change affects those outputs. Compare the host’s requested outcome with the saved revision, source passages, visible slide count, charts and spoken text. Trace any cap, skipped check, partial result or fallback that changed the outcome. A report validator verifies reporting structure.
- **Module implementation.** Map every contracted item to its owning workspace and a customer action. For each release, a validation agent performs those actions through the running UI and records the environment, observed results and evidence against each item. Keep items open while their implementation or real-use evidence is missing.
