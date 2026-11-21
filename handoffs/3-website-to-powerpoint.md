# Handoff: Website to PowerPoint (module 3)

Contract: handoffs/3-website-to-powerpoint.contract.md
Commit/base: `bf6c348`, `1200fad`, `5236995`, `8a2c02d`, `cacbab8` and `bf61f9e`.
Files changed: `shared/website-walkthrough.ts`, `backend/src/services/website-{capture,powerpoint}.ts`, `backend/src/repositories/website-walkthrough.ts`, `backend/src/routes/website-walkthrough.ts`, `frontend/components/walkthrough/`, `frontend/lib/website-walkthrough.ts`, `frontend/components/projects/ProjectStudio.tsx`.

## Frontend done

- A private project's website walkthrough shows URL, audience, goal and depth before approval, then capture progress, screenshots, gaps and the PowerPoint download. `/research`

## Backend done

- A durable capture job applies approved link depth and read-only navigation, saves screenshots and provenance, and reopens the same owner-checked download. `backend/src/services/website-capture.ts` and `backend/src/repositories/website-walkthrough.ts`
- The PowerPoint pairs public site facts with captured pages and source links. The host's planning instructions stay private. `backend/src/services/website-powerpoint.ts`

## Current module coverage: Module 3

| ID | Status | Evidence class | Evidence | Gap |
|----|--------|----------------|----------|-----|
| AC-1 | verified | fixture | Independent Chrome workflow approved one scope and duplicate API approval reused the same job. The approval review shows the page budget. `/private/tmp/copitch-site-eval-aJSCWg/ui-job.json` | — |
| AC-2 | verified | fixture | Actual Chromium followed the approved links, captured four pages and recorded two failures. Restricted transport tests rejected outside navigation, unsafe destinations and writes. `backend/tests/website-capture.test.ts` | — |
| AC-3 | verified | fixture | Six slides opened in LibreOffice. Four embedded screenshots matched their stored files, and source hyperlinks matched captured URLs. `/private/tmp/copitch-site-eval-aJSCWg/ui-render/slide-4.png` | — |
| AC-4 | verified | fixture | Fresh mobile Chrome reopened the result. Restarting the API recovered identical PPTX bytes. A second account was denied the job, image and download. `docs/audit/09-release-decisions.md` | — |
| AC-5 | verified | fixture | Controlled transport denied localhost, private and mixed addresses and unauthorized redirects. An eligible retry completed. `backend/tests/website-capture.test.ts` | — |
| AC-6 | unverified | none | The Linux amd64 release images passed local HTTPS readiness. Chrome approved Python.org at depth 0, packaged Chromium captured one page, and a fresh sign-in after API restart recovered the same PPTX and JPEG bytes. `/private/tmp/copitch-packaged-m3-japx2vk7/metrics.json` | AWS deployment awaits owner review. |
| AC-7 | verified | fixture | Depth 0 captured only the root. The default 2 captured depths 0, 1, 1 and 2 with zero depth-3 requests. Depth 3 reached the extra route. Invalid values were rejected. `docs/audit/09-release-decisions.md` | — |

Public-site check: Chrome signed in to the isolated preview, approved Python.org at depth 1, then reopened the completed capture in a clean mobile browser. Five captures included Downloads, Python for Beginners, Documentation and Source Releases with zero failures. The download matched the backend bytes and opened in LibreOffice. Its notes omitted navigation and did not cut words. `/private/tmp/copitch-user-review-walkthrough-clean.log` and `/private/tmp/copitch-pptx-qa/python-preview-walkthrough-clean.pptx`

Owner decisions pending: AWS release approval and target.

## Next module plan

1. After AWS release approval, run the hosted check through a fresh browser and reopen the same saved PowerPoint.
