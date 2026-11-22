# Handoff · Interactive pitch studio

Contract: handoffs/1-pitch-studio.contract.md
Commit/base: `d0196ac` plus the current working tree.
Files changed: Express studio and research handlers, Python signaling, Next.js research UI, tests, and the architecture and acceptance documents.

The native rehearsal used a synthetic private account and the configured OpenAI providers.

## Frontend done

- The conversation shows one interviewer reply and the active research plan. Attachments and source selection are saved against the current project. The host edits or approves the exact plan. [Studio](../frontend/components/research/ResearchWorkspace.tsx)
- Voice runs over an opt-in WebRTC connection. The browser releases its microphone after the research acknowledgement. The pitch viewer appears for a completed grounded script. Needs input asks for another source or an example. [Voice hook](../frontend/hooks/research/use-voice-agent.ts)

## Backend done

- Express applies model actions against the current interview phase, project and proposal. Approval is bound to an explicit button or the heard spoken plan. The same controller handles typed and sideband turns. [Turn controller](../backend/src/services/studio-turn.ts) · [Realtime sideband](../backend/src/services/live-interviewer.ts)
- The research worker reads approved public pages, executes the reviewed public queries in one request, and preserves file locations. If the first script fails verification, the worker tries one shorter draft from the same evidence. It commits the verified script and memo or records Needs input. [Research worker](../backend/src/workers/research.ts) · [Redraft regression](../backend/tests/studio-research.test.ts)

## Current module coverage: Module 1

| ID | Status | Evidence class | Evidence | Gap |
|---|---|---|---|---|
| AC-1 | verified | fixture | Fresh Chrome sign-in and private project creation in the current UI. [Browser rehearsal](../scripts/check-pitch-studio.ts) | |
| AC-2 | verified | fixture | Account integration denies access to another project's resources. [Account suite](../backend/tests/account-projects.test.ts) | |
| AC-3 | unverified | none | Two Chrome runs with a virtual mic and the configured provider each saved three distinct English → Telugu → English turns and played replies in the matching language. A separate run interrupted remote audio with Hindi. [Browser voice replay](../simulations/voice/realtime-smoke.ts) | One Telugu reply transcript appeared to substitute a different word for “farmers.” Verify pronunciation, mixed speech and laptop speaker echo on a physical device. |
| AC-4 | verified | fixture | A plan limited to private material starts one job after explicit approval. [Studio turn suite](../backend/tests/studio-turn.test.ts) | |
| AC-5 | verified | live | In Chrome the saved files-only proposal was approved by recorded speech after matched playback. A closing reply drained and stopped all mic tracks. | Chat progress and job identity across disconnect also have fixture coverage. |
| AC-6 | verified | live | Native Chrome generated a speakable pitch from private pilot material, displayed a Recharts view of 12, 18 and 24 from CSV rows 2–4, and downloaded the same 1,849 bytes shown in the Markdown pane. [Browser rehearsal](../scripts/check-pitch-studio.ts) | |
| AC-7 | verified | fixture | Browser rehearsal restarted API during the job and restored the result. [Browser rehearsal](../scripts/check-pitch-studio.ts) | |
| AC-8 | verified | fixture | Browser rehearsal completed the typed flow with the mic denied. [Browser rehearsal](../scripts/check-pitch-studio.ts) | |
| AC-9 | verified | fixture | Rehearsal checked that mixed units withheld the comparison. [Browser rehearsal](../scripts/check-pitch-studio.ts) | |
| AC-10 | unverified | none | Native studio rehearse only. | AWS deployment and second-device hosted recovery. |
| AC-11 | unverified | none | Initial configured-provider checks passed. The expanded eval exposed intermittent plan selection. A separate live research run produced a verified personal introduction from synthetic notes and closed with a takeaway, with no invented action request. [Conversation eval](../simulations/studio/conversation_eval.ts) | Repeat the final browser conversation and resolve intermittent model routing. |
| AC-12 | verified | live | Chrome interrupted the spoken plan with “Start the research.” The app saved the utterance, left the plan open and queued no job. Clicking Start research on that plan queued research. The closing reply finished and released the mic. [Browser voice replay](../simulations/voice/realtime-smoke.ts) |
| AC-13 | verified | live | The research worker attempted the supplied site and public search. Direct HTTPS failed and search returned no usable citations. A native Chrome project with insufficient CSV evidence also reached Needs input without a pitch and restored that outcome after sign-in. [Publication checks](../backend/tests/studio-research.test.ts) | |

Owner decisions pending: physical rehearsal and AWS release approval.

## Next module plan

1. Use a saved Module 1 context to review an HTML deck and private narration.
2. During delivery, interrupt a slide and review a meaningful before/after change. Accept to publish and advance after stage paint, or reject and stay on the approved slide. [Module 2 plan](../docs/module-2-html-presentation.md)
