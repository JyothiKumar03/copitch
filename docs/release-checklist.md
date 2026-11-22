# Release checklist (go / no-go)

> **Status: Ready for local owner review. AWS promotion pending.** The remaining live-provider, physical voice and hosted gates are recorded below.

The owner signs off on each line before AWS promotion. "Local" means `localhost:3000` against the live OpenAI provider. "Fixture" means automated tests.

## A. Code health (fixture)

| Check | Command | Result 2026-11-22 |
|---|---|---|
| Backend tests | `cd backend && bun --no-env-file test tests` | 252 pass, 0 fail against the exact 08:40:02 package. `/private/tmp/copitch-completion-release/stop-backend-test.log` |
| Typecheck | `bun run typecheck` | clean |
| Lint | `bun run lint` | Passed against the 08:40:02 source. `/private/tmp/copitch-completion-release/stop-lint.log` |
| Offline HTML privacy | `bun run check:html` | Chrome passed at three sizes with an embedded walkthrough screenshot and no private screenshot URL. `/private/tmp/copitch-completion-release/stop-html.log` |

## B. Customer journeys (local, live provider, Chrome)

| Journey | Evidence | Result |
|---|---|---|
| Sign up → project → website walkthrough of `https://jk-ai.in` (depth 1) | `simulations` script in the session scratchpad; trace `website.capture_attempt` | 5 pages in about 3 s. The bare domain failed TLS, so www was captured automatically |
| *Build presenter deck* → studio shows the source chip → typed request → plan → *Start research* | Screenshots `proposal.png`, `research-done.png` | Plan correct (subject, audience, 5-slide outcome). The false "reply could not be read" banner is fixed (language tag) |
| Research → 5 slides | Traces `presentation.readiness` 0.98 ready, `plan_acceptance` 5/5 verified, `deck.preparation` completed 23.6 s | 5 slides, a bar chart, 3 screenshot slides, footer "Source: jk-ai.in" |
| Live presentation and interruption | Previous Chrome acceptance (Module 2) | Re-run on the walkthrough deck before promotion |
| Voice: first "Hi", live captions, spoken approval | `simulations/voice/live-voice-probe.ts` | Passed on 2026-11-22 00:3x. Re-run on the release candidate |
| Physical microphone, room audio | Manual | **Open**: needs the owner's device |

## C. Operations

| Check | Status |
|---|---|
| Restart the dev stack after pulling. `bun --hot` does not register new Express routes, and an orphan API process can keep port 3001 (`lsof -iTCP:3001`) | Documented; was the cause of walkthrough 404s |
| Release images (api, web, voice, gateway) build for linux/amd64 and pass `deploy/check-images.py` | The 08:40:02 manifest matched after terminal Mission Stop and the SDP answer compatibility change. Local HTTPS, authenticated reopen after restart, trace redaction and the exact packaged customer journeys passed. `/private/tmp/copitch-completion-release/stop-image-list.txt` and `/private/tmp/copitch-ac15-stop/site-zip-verification.json` |
| AWS CLI and credentials on the release machine | **Open**: not installed on this workstation |
| Owner inputs: region, VPC, public subnet and zone, hostname, Secrets Manager ARN (`OPENAI_API_KEY`, `OPENAI_TEXT_MODELS`, `VOICE_WORKER_TOKEN`), instance size (default t3.medium), log retention (7 days) | **Open** |
| Provider retention check for the Decisions endpoint before hosted use with sensitive input (`docs/audit/09`) | **Open** |
| Backup and restore | The 08:21:59 package restored an online SQLite backup into a separate local HTTPS stack. A fresh owner sign-in recovered research, the approved deck revision, a screenshot and the same confirmed PowerPoint bytes. Account isolation and a clone-only write passed. Hosted EBS restore is open. `/private/tmp/copitch-restore-local/restore-proof.json` |

## D. Open product and go-live gates

The projector fixture confirmed the subject header and spacing for three- and four-point slides. The local live-provider, physical voice and deployed journeys remain open.

## E. 07:44 IST P0 integration snapshot

| Check | Result |
|---|---|
| Backend regression | 237 passed. `/private/tmp/copitch-s2-evidence/backend-all.log` |
| Current studio | Installed Chrome 157 showed HTTP 200 and document widths 1440 and 390 at the matching viewports. The API returned ready and anonymous Mission returned 401. `/private/tmp/copitch-chrome-now/result.json` |
| Refreshed owner flow | Installed Chrome 157 registered a disposable local account, opened both walkthrough modes, retained light mode after reload and reopened the private project after a fresh mobile sign-in. `/private/tmp/copitch-chrome-now/owner-smoke.json` |
| Local images | Four Linux amd64 images passed local HTTPS, SQLite reopen, trace redaction and offline HTML with an embedded screenshot. Source manifest SHA-256 `7d2d53e2f366c120bb5ea70d11b9ef72a53c083837f81a96823e3b2543cb4034`. `/private/tmp/copitch-completion-release/p0-image-list.txt` and `p0-smoke.log` |
| Projector | Chrome fixtures matched the approved subject and showed three- and four-point vertical extents of 72.7 percent with no reported layout issues. `/private/tmp/copitch-completion-p5/projector.log` |
| Release decision | Local packaging and owner review can proceed. Live automatic deck generation reached Needs input because the running app had no usable provider configuration. Physical device, provider, credentialed site and AWS acceptance remain open. `handoffs/1-director-completion.md` |

## F. PowerPoint selection scope

Verify both Page capture and Agent mode in installed Chrome. Use a saved walkthrough with distinct facts, titles, links and screenshots. Confirm that a new selection starts empty, that a cancelled review creates no export, and that the selected items and host additions agree with the opened `.pptx`. Check slide and notes text, links and media for excluded items. Reopen the selected export from a fresh sign-in and compare the file digest. Repeat from a second account and try an item ID from a different walkthrough. `handoffs/3-website-to-powerpoint.contract.md` AC-8–AC-11 covers these checks.

## G. Owner review before 10:30 IST

1. Open the local studio in Chrome. In **Website walkthrough → Agent mode**, use public Python documentation at depth 3 with the goal below. Compare the screenshot and written fact for each saved step. Check which requested topics appeared and which paths stayed unvisited.
2. Open **Choose PowerPoint content** and confirm it starts empty. Choose one fact and one screenshot, add a line of your own, review the slide plan, then confirm. Open the exported file and verify those exact additions. Sign in from a fresh Chrome profile and reopen the confirmed export.
3. Start an approved deck with laptop speakers on. Speak a question partway through a sentence and note when narration ducks, when your caption appears and where playback resumes. Repeat on headphones and with hold-to-talk. Try a typed question and switch theme once.
4. With a configured provider, retry the existing ten-slide project. Confirm the visible count, slide copy and narration before approval. If generation pauses, record the visible status.
5. For each issue, record the project link, last action, expected outcome and observed outcome. Keep time from 10:00 for fixes and an owner rerun. Confirm the target and approval before any hosted work.

| Rehearsal | Starting page and audience | Goal to paste | What to inspect |
|---|---|---|---|
| Broad technical walkthrough | `https://docs.python.org/3/` · New Python developers · depth 3 | Show new developers the Python tutorial, how to create and activate a virtual environment and install dependencies using pip install, and where to find the Python standard library and language references. Record the useful commands and facts from these pages. | Reference and tutorial routes, Windows and Unix activation, pip instructions, source URLs and explicit coverage gaps. The browser approval confines browsing to the public site. |
| Portfolio presentation | `https://www.jk-ai.in/` · New teammates · depth 3 | Show who Jyothi is, their projects and how to contact them. | The saved portrait, representative project details and the visible contact link. Check that the browser records external profiles as outside scope and that the saved source can be added to the presenter studio. |
