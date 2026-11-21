# Handoff: Private project accounts (module 1)
Contract: handoffs/1-pitch-studio.contract.md
Commit/base: 368908f with account integration in the working tree.
Files changed: backend/src/{app.ts,controllers/accounts.ts,middleware/{account,host-session}.ts,repositories/{accounts,session}.ts,routes/accounts.ts,services/interview.ts,types/interview.ts}, backend/tests/account-projects.test.ts, frontend/{app/research/page.tsx,components/projects/ProjectStudio.tsx,lib/{api,interview,projects,research}.ts,types/research.ts}.

## Frontend done

- Open studio from the home page, create an account, name a project, and sign in from a new browser to retrieve it. The private project route is `/research?project=<session UUID>`.

## Backend done

- Accounts use Argon2id password hashes and revocable hashed session credentials in SQLite. The browser receives an HttpOnly cookie. Project ownership gates every existing host session route through `backend/src/middleware/host-session.ts`.
- The API lists projects by owner and allows the owner of an existing tab credential to import its session. Import revokes the original bearer. The release configuration requires an account for provider-consuming chat and session commands. `bun test tests/account-projects.test.ts` passed 2 tests and 26 assertions.

## Current module coverage: Module 1

| ID | Status | Evidence class | Evidence | Gap |
|---|---|---|---|---|
| AC-1 | verified | fixture | Chrome drove home → registration → project list → studio → list → reopen. It checked the agent bounds were right of the conversation. | |
| AC-2 | verified | fixture | Two-account Chrome check denied the other account’s project. The HTTP fixture retrieved the real saved pitch as its owner and denied the other account. | |
| AC-3 | unverified | none | | Live multilingual mic behavior belongs to the voice handoff. |
| AC-4 | unverified | none | | Approved research and deduplication belong to the integrated handoff. |
| AC-5 | unverified | none | | A live voice progress turn belongs to the integrated handoff. |
| AC-6 | unverified | none | | Chart rendering and artifact selection belong to the studio handoff. |
| AC-7 | unverified | fixture | Chrome signed in from a fresh context and reopened the same project. An HTTP fixture recovered its saved pitch. | The coordinator verifies worker process termination during the browser flow. |
| AC-8 | unverified | none | | The account browser check covered typed sign-in and project creation. The integrated test covers denied mic through pitch completion. |
| AC-9 | unverified | none | | Chart withholding belongs to the artifact checks. |
| AC-10 | unverified | none | | Hosted deployment and second-device checks remain outstanding. |

Owner decisions pending: Hosted release approval.

## Next module plan

1. Use the saved project and its owner when opening the host’s live presentation. Issue separate credentials for the audience projection.
