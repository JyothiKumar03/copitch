# Handoff: Chat-first pitch studio rehearsal (module 1)
Contract: handoffs/1-pitch-studio.contract.md
Commit/base: Docker preview `b013215` on loopback, with a fresh Chrome account, configured OpenAI and synthetic project data. Source follow-up `5e874c4` was exercised on a separate loopback API and account.
Files changed: the studio conversation, composer, question cards, tool receipts, event subscription and pitch viewer. The existing browser fixture was also updated.

## Frontend done

- The composer accepts typed messages, documents, pasted sources and microphone input. On the source build, Chrome measured zero horizontal overflow at 1440, 1024, 768 and 390 px. The bottom of the composer was at 833 px on an 844 px phone viewport.
- Chrome selected **Board** with Tab and Enter. A second tab submitted an earlier answer and received HTTP 409. The UI offered the current question. After reload, Board remained checked and disabled, the decision question was actionable and research had not started.
- Each chart value links to its source in `5e874c4`. In Chrome, the Week 1 link focused the CSV row 2 footnote. Escape closed the artifact and returned focus to the pitch file. Completed turns use a polite log. Interim text is outside continuous announcements. A physical screen-reader session remains unverified.

## Backend done

- In the packaged browser, a real file question returned “The buyer wants a two-week onboarding pilot.” from PDF page 1 and “Decision Approve two pilot seats” from PowerPoint slide 3. The PDF text stream and the PowerPoint presentation order both match. The UI showed the completed source-read call. [Uploaded source files](../backend/tests/fixtures/sources)
- During approved research, a host correction received an explanation and left the running job ID unchanged. After the browser went offline and reconnected, the job produced one selectable artifact. A corrupt PDF produced a failed parser receipt on the source build. Dismissing it and sending a greeting worked.

## Current module coverage: Module 1

| ID | Status | Evidence class | Evidence | Gap |
|---|---|---|---|---|
| AC-1 | verified | live | On `b013215`, Chrome registered, created two private projects, opened their conversations and reopened the saved weekly result from a fresh sign-in. | |
| AC-2 | verified | live | An independent account on the earlier `84fba82` gateway had an empty project list, saw “This project is unavailable to your account” at the first account’s URL, and received 401 for its exact pitch file. The updated browser fixture repeated account isolation. | |
| AC-3 | unverified | none | This operator used typed input. | Physical English/Hindi speech and audible interruption need a room microphone and speakers. |
| AC-4 | verified | fixture | The updated `scripts/check-pitch-studio.ts` completed the duplicate approval and recorded zero external lookup events. The separate live browser approved the exact displayed files-only scope. | |
| AC-5 | unverified | none | In the live source build a **typed** progress question returned the running job’s status and survived fresh sign-in. | Spoken progress was outside this operator’s rehearsal. See the separate voice handoff. |
| AC-6 | verified | live | The packaged pitch displayed Week 1 = 12, Week 2 = 18 and Week 3 = 24 bookings, with different evidence IDs matching CSV rows 2–4. The downloaded 1,595 bytes equaled the Markdown view. SHA-256 `00dc7ebb8dfa9e33fdc89c059a90f540f05eace84494662a491a4cffc2b34187`. | Independent prose verification used the disclosed source-extract fallback on this run. The source-build run delivered a full script. |
| AC-7 | verified | fixture | The updated browser fixture restarted the isolated worker and recovered one result. On the Docker preview, Chrome went offline during research and restored the host’s approval, acknowledgement, correction and artifact in a fresh sign-in. | |
| AC-8 | verified | fixture | The updated browser fixture denied the microphone and completed the brief with typed input. | |
| AC-9 | verified | fixture | The updated browser fixture withheld the chart for USD/EUR values while retaining the evidence in Markdown. | |
| AC-10 | unverified | none | The operator exercised Docker on loopback. | AWS HTTPS, a separate physical device and hosted recovery need their own rehearsal. |

The browser fixture used an isolated temporary copy and the installed workspace dependencies. It reported successful microphone denial and typed recovery, account isolation, duplicate approval, worker restart, chart data, download comparison and mixed-unit handling.

Owner decisions pending: Physical-room acceptance of launch languages and approval to promote the tested revision to AWS.

## Next module plan

1. Before promotion, rehearse the private voice workflow using a room microphone and repeat fresh-device recovery on the approved AWS hostname.
2. Module 2 can begin with a customer selecting a saved revision, approving the private deck and opening its audience view.
