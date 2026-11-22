# Handoff: Director-led pitch delivery (module 1)

Contract: handoffs/1-director-completion.contract.md
Commit/base: `ff56d35` plus the integration worktree. The owner requested an uncommitted local candidate.
Files changed: Director mission types, repository, worker and routes, research studio and live presentation controls, slide preparation and recovery, guarded SiteRun and PowerPoint, and release checks.

## Frontend done

- The independent Chrome fixture showed a private Mission panel with contract scope changes, budget, queued activity, stop, take over and exact-revision review. `/private/tmp/copitch-director-ui/evidence.md`
- The four-slide request, private recovery draft, all three recovery actions, revision-specific edit review and saved deck reopen worked in Chrome fixtures. `/private/tmp/copitch-s2-evidence/browser-results.json` and `/private/tmp/copitch-rehearsal-qa/run-6.log`
- A public walkthrough exposed screenshots, coverage, a private PowerPoint download and an idempotent **Build presenter deck** source action. `/private/tmp/copitch-site-public-1795313463873/checks.json`

## Backend done

- Typed and spoken requests share checked deck commands. Draft editing and approval preserve the previously published revision until an accepted change. `backend/src/services/studio-turn.ts` and `backend/src/repositories/deck-preparation.ts`
- Director outcome contracts and child receipts persist by project, revision and job identity. Provider calls reserve cost before dispatch, and requests with unresolved charges keep their reservation. `backend/src/repositories/mission.ts` and `backend/src/services/mission-metering.ts`
- Generated slide text now keeps missing-content directions in private recovery. Passing audience chart values omit internal evidence IDs. `/private/tmp/copitch-completion-p5-stage.log`

## Current module coverage: Module 1

| ID | Status | Evidence class | Evidence | Gap |
|---|---|---|---|---|
| AC-1 | verified | fixture | Chrome held Space five times, with one WAV and grounded reply per hold. Revision and sentence survived resume, echo veto, stale pin refusal and mic denial. `/private/tmp/copitch-p1-evidence/chrome-production.log` and `chrome-boundary.log` | — |
| AC-2 | unverified | none | Prerecorded speech and simulated acoustics. | Physical speakers, microphone, headphones and acoustic measurement. |
| AC-3 | verified | fixture | Chrome 12 requested, two checked, ten private blanks, three usable recovery actions, previous revision reopened. `/private/tmp/copitch-s2-evidence/browser-results.json` | — |
| AC-4 | verified | fixture | Chrome approved a website-based revision, rejected a stale approval, and stopped the old browser child after the host narrowed the scope. Stop persisted a terminal research status, preserved three captures and prevented the next worker from constructing a provider. Take over reopened exact revision 1. Stage creation required separate approval. `/private/tmp/copitch-ac12-current/run.log` and `/private/tmp/copitch-final-mission-stop.log` | — |
| AC-5 | unverified | none | The exact named public portfolio yielded six reviewed HTML slides in a scripted fixture. Chrome verified the subject, narration, screenshot evidence and fresh sign-in. `/private/tmp/copitch-jyothi-presenter-qa/verified.json` | Real voice and live provider run with the two host-added details. |
| AC-6 | unverified | none | Typed four-slide control and private draft edit passed on local fixtures. `/private/tmp/copitch-s2-evidence/browser-results.json` | Real spoken commands and exact edited revision reopen. |
| AC-7 | verified | fixture | Content and empty-highlight title edits rejected safely. Approval advanced once, a stale proposal returned 409, and stage and offline HTML showed only the approved text. `/private/tmp/copitch-rehearsal-qa/director-full.log` | — |
| AC-8 | unverified | none | Structured manual recovery and budgeted fixture Director tests. | Actual provider evidence for a sparse twelve-slide mission. |
| AC-9 | unverified | none | The focused public docs rerun saved 18 steps with matching screenshots and B evidence. A separate Chrome fixture rendered and reopened three approved presenter HTML slides from those exact captures. `/private/tmp/copitch-site-public-1795313463873/checks.json` and `/private/tmp/copitch-site-to-html-qa/verified.json` | A disposable signed-in site, credential handling and live model metering. |
| AC-10 | unverified | none | Browser policy tests covered walls, continued branches, stop and owner boundaries. `backend/tests/site-agent.test.ts` | Exact credential case and independent final fixture. |
| AC-11 | unverified | none | Site run resumed after its first screenshot. In a separate fixture the API exited after persisting a verified goal. Fresh Chrome reopened the same engine, verdict, four receipts and screenshot with zero new calls, although the restarted service lacked its model. The last-lease regression covers already-finished results after the retry limit. The Director resumed its original research child and delivered once after API restart. `/private/tmp/copitch-site-terminal-restart/after-chrome.json`, `regression.log` and `/private/tmp/copitch-rehearsal-qa/director-full.log` | A permitted disposable write and its uncertain-result reconciliation remain open. |
| AC-12 | verified | fixture | One current project reopened its ordered mission, approved stage revision, context, deck, Site gallery, screenshot, catalog and selected PPTX in fresh mobile Chrome. All saved bytes matched and a second account was denied. An independent `ff56d35` upgrade preserved the original context, both deck revisions, archived PowerPoint and screenshot with the same privacy boundaries. `/private/tmp/copitch-ac12-current/compare.json` and `/private/tmp/copitch-ac12-legacy/compare.json` | — |
| AC-13 | verified | fixture | All six exact public portfolio slides were inspected at 1280×720 against saved passages and clean narration. Title, screenshot ratio and citations matched. A separate numeric/presentation check passed bars, a line chart and a grounded donut, and measured 72.7 percent content fill for three- and four-point slides. `/private/tmp/copitch-jyothi-presenter-qa/verified.json`, `/private/tmp/copitch-completion-p5/projector.log` and `/private/tmp/copitch-completion-release/restart-html.log` | — |
| AC-14 | verified | fixture | Integrated Chrome ran landing through offline export at 390×844 and repeated stage controls at 1440 and 1280 px. The now-integrated focus fix restored the preview heading for Escape outside fullscreen and for Exit live view. Slide 2 and revision 2 survived. Keyboard F exited native fullscreen and returned focus. Offline HTML rendered six slides and three authorized screenshots. `/private/tmp/copitch-ac14-current/evidence.md` and `fixed-run.log` | — |
| AC-15 | verified | fixture | The exact 08:40:02 Linux amd64 images passed 252 backend checks, typecheck, lint, HTTPS smoke and Chrome offline export. Chrome reopened byte-identical approved files-only research and deck revision, then separately captured a public Python page and confirmed only the selected fact and original JPEG in its byte-identical PowerPoint. `/private/tmp/copitch-ac15-stop/research-proof.json`, `site-zip-verification.json` and `/private/tmp/copitch-completion-release/stop-image-list.txt` | — |
| AC-16 | unverified | none | Online SQLite backup restored into a separate instance on the exact 08:21:59 package. Fresh Chrome sign-in recovered matching research, deck, screenshot and PowerPoint bytes, denied a second account and isolated a new write to the clone. `/private/tmp/copitch-restore-local/backup-proof.json` and `restore-proof.json` | Owner approval, retention and infrastructure decisions, public HTTPS verification and a hosted EBS snapshot drill. |

Owner decisions pending: Public AWS deployment, physical microphone rehearsal, configured priced model support for browser guidance, and approved disposable login test inputs.

## Next module plan

1. Finish the independent Mission and title-card regression runs. Record the approved revision, restart and reopen evidence.
2. Repeat the public Python walkthrough after the relevance and wall fixes. Compare step evidence and the downloaded artifact.
3. Rebuild the exact local release snapshot and rehearse interruption. Mark hosted acceptance only after owner approval and observable deployed results.
