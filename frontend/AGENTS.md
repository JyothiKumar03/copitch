# Frontend

Use the Next.js App Router in this workspace. Start the host journey at `frontend/app/research/page.tsx`. Review and presentation controls live in `frontend/components/deck`. Use shadcn/ui primitives, Tailwind CSS and TanStack Query, installed through the repository's Bun workspace.

## File ownership

| Folder | Responsibility |
| --- | --- |
| app/ | Route pages, layouts, global Tailwind styles and client provider composition. Keep pages thin. |
| components/ui/ | Shared shadcn/ui primitives. Use Tailwind utilities and theme tokens for styling. |
| components/<feature>/ | Compose feature views and controls for the host workspace, review or stage. |
| hooks/<feature>/ | TanStack Query query keys, queries, mutations and cache updates. Keep voice transport and stream subscription lifecycles in dedicated hooks. |
| lib/ | Typed HTTP and event transport functions. Keep fetch, status handling, parsing and abort signals here. |
| types/ | Frontend contracts and component prop types organized by domain. Use TypeScript type aliases and type-only imports. Reserve ambient declarations for browser APIs that need them. |

Use T-prefixed PascalCase for application type aliases, camelCase for UI functions and hooks, and PascalCase for JSX components. Keep API request and response field names in snake_case. Map to camelCase UI state in lib/ when names differ. Preserve standardized browser API names in ambient declarations.

Keep each responsibility in its own file. Reuse shared wire contracts when available. Put the QueryClient provider at a stable client boundary. Key server state by project or session and applicable revision. Clean up subscriptions and abort active reads when the session changes. Keep transient input and microphone state local. Send host commands through the controller and render its acknowledged state.

## Presentation behavior

- Keep typed input and manual playback controls usable when microphone permission or audio setup fails.
- Give the host the microphone and control channel. Render only slide content on the fullscreen presentation stage. Keep the brief, transcript, notes, source uploads and private cues on the host surface.
- Acknowledge the exact slide revision or browser frame after the stage displays it. Wire single-screen fallback to the same acknowledgment path. Only the controller schedules narration and advances beats.
- Restore reopened or reconnected sessions paused. Ignore stale stream events after an interruption or revision change using the controller's identifiers.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Visual system

Use the semantic Tailwind tokens in `frontend/app/globals.css` for evergreen workspace surfaces, chalk document and slide surfaces, chartreuse actions, borders, focus and feedback. Use font-display (Newsreader) for editorial titles and Hanken Grotesk for controls and data. Compose controls from `frontend/components/ui`. Keep mic and job status readable in text, and check the host journey at desktop and mobile widths with keyboard controls. Keep the fullscreen stage free of workspace navigation. Label landing-page examples clearly.
