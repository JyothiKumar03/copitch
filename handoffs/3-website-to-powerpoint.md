# Handoff: Website to PowerPoint (module 3)

Contract: handoffs/3-website-to-powerpoint.contract.md
Commit/base: `ff56d3598096deda85b6414e42f5e42c7c381849` with working-tree changes.
Files changed: `shared/site-run.ts`, `shared/walkthrough-selection.ts`, `backend/src/{routes,workers}/site-run.ts`, `backend/src/routes/walkthrough-selection.ts`, `backend/src/services/{site-agent,site-browser,site-source,walkthrough-selection,website-powerpoint}.ts`, `frontend/components/walkthrough/`.

## Frontend done

- A private project's website walkthrough shows URL, audience, goal and depth before approval, then capture progress, screenshots, gaps and the PowerPoint download. `/research`
- In both capture modes a host chooses individual saved items, adds their own text, reviews the exact slide plan and confirms the download. `frontend/components/walkthrough/PowerPointSelection.tsx`

## Backend done

- A durable capture job applies approved link depth and read-only navigation, saves screenshots and provenance, and reopens the same owner-checked download. `backend/src/services/website-capture.ts` and `backend/src/repositories/website-walkthrough.ts`
- New PowerPoints contain the confirmed saved text and images and explicit host additions. The owner can reopen each saved selection and the original archived file. `backend/src/services/walkthrough-selection.ts` and `backend/src/repositories/walkthrough-export.ts`

## Current module coverage: Module 3

| ID | Status | Evidence class | Evidence | Gap |
|----|--------|----------------|----------|-----|
| AC-1 | verified | fixture | Independent Chrome workflow approved one scope and duplicate API approval reused the same job. The approval review shows the page budget. `/private/tmp/copitch-site-eval-aJSCWg/ui-job.json` | — |
| AC-2 | verified | fixture | Actual Chromium followed the approved links, captured four pages and recorded two failures. Restricted transport tests rejected outside navigation, unsafe destinations and writes. `backend/tests/website-capture.test.ts` | — |
| AC-3 | verified | fixture | LibreOffice opened six current downloads. Screenshot aspect matched the source and projector measurements kept all dense text in frame. Archived files remained byte-identical. `/private/tmp/copitch-curated-pptx-qa/projector-check.log` and `post-fix.log` | — |
| AC-4 | verified | fixture | Fresh mobile Chrome reopened the result. Restarting the API recovered identical PPTX bytes. A second account was denied the job, image and download. `docs/audit/09-release-decisions.md` | — |
| AC-5 | verified | fixture | Controlled transport denied localhost, private and mixed addresses and unauthorized redirects. An eligible retry completed. `backend/tests/website-capture.test.ts` | — |
| AC-6 | unverified | none | The Linux amd64 release images passed local HTTPS readiness. Chrome approved Python.org at depth 0, packaged Chromium captured one page, and a fresh sign-in after API restart recovered the same PPTX and JPEG bytes. `/private/tmp/copitch-packaged-m3-japx2vk7/metrics.json` | AWS deployment awaits owner review. |
| AC-7 | verified | fixture | Depth 0 captured only the root. The default 2 captured depths 0, 1, 1 and 2 with zero depth-3 requests. Depth 3 reached the extra route. Invalid values were rejected. `docs/audit/09-release-decisions.md` | — |
| AC-8 | verified | fixture | Installed Chrome confirmed empty defaults in both modes. Review showed the chosen items across two groups, and cancelling created no export. `/private/tmp/copitch-curated-crossgroup-qa/run.log` | — |
| AC-9 | verified | fixture | Both modes produced only the selected fact and byte-identical screenshot. A separate confirmation included an explicitly selected link and the exact host text. XML and media inspection found no excluded items. `/private/tmp/copitch-curated-pptx-qa/xml-check.log` | — |
| AC-10 | verified | fixture | Duplicate confirmation reused the export, a change saved separately and fresh mobile sign-in returned identical bytes. Wrong owner, project and capture requests returned 404. `/private/tmp/copitch-curated-pptx-qa/checks.json` | — |
| AC-11 | verified | fixture | Empty, unknown, foreign, stale and unapproved submissions failed. The earlier hash stayed the same, and the normal UI could confirm a corrected selection. `/private/tmp/copitch-curated-pptx-qa/post-fix.log` | — |

The public Python documentation run recorded 18 steps across nine pages in Chrome. It reached virtual environments, Windows and Unix activation and three forms of pip installation. It reported partial coverage with 199 unvisited paths. A separate local replay used its exact captures to confirm five facts and one screenshot in a three-slide `.pptx`. A fresh sign-in retrieved the same bytes. `/private/tmp/copitch-site-public-1795313463873/checks.json` and `/private/tmp/copitch-python-selected-1795314468282/checks.json`

Owner decisions pending: AWS release approval and target.

## Next module plan

1. After AWS release approval, run the hosted check through a fresh browser and reopen the same saved PowerPoint.
