# Handoff: Private pitch studio (module 1)
Contract: handoffs/1-pitch-studio.contract.md
Commit/base: 368908f, followed by the local implementation commits on jk/feat/module-one-pitch-studio.
Files changed: studio, account and research services, voice adapter, AWS packaging, operator checks and the browser fixture. See the branch diff for individual paths.

## Frontend done

- Sign in, create a project, and reopen it from a fresh browser. Open the pitch file from the center conversation while the agent remains on the right. The private dialog supports chart preview, source inspection and download. See [the integrated browser check](../scripts/check-pitch-studio.ts).

## Backend done

- Account ownership, revocable login cookies, research leases and revision-scoped artifact reads support recovery across process and browser restarts. A progress question can be answered in English or Hindi while the same research job continues.
- Authenticated signaling connects the host microphone to OpenAI transcription over WebRTC. Python synthesizes authorized replies, and the browser owns playout and interruption.
- ECS on EC2 runs the four container images with one SQLite writer on encrypted EBS. CloudWatch correlates requests with durable research attempts. Operators can look up latency percentiles and rehearse restoration. See [deployment and tracing](../docs/aws-operations.md).

## Current module coverage: Module 1

Eight of ten release criteria passed. Seven have local fixture evidence and AC-5 has live provider evidence. AC-3 and AC-10 remain open.

| ID | Status | Evidence class | Evidence | Gap |
|---|---|---|---|---|
| AC-1 | verified | fixture | Browser signup and reopen, measured desktop chat and agent positions in scripts/check-pitch-studio.ts | |
| AC-2 | verified | fixture | A second account could neither list the project nor download the first account's saved pitch in the browser check | |
| AC-3 | unverified | none | Managed transcription was exercised with synthetic audio; the English and Hindi checks included a Hindi recognition error | A physical microphone, two speakers and interruption during audible playback remain to be verified |
| AC-4 | verified | fixture | CSV upload, files-only approval twice, matching job identity and zero external lookup requests in the integrated check; backend/tests/research-to-pitch.test.ts counts one draft and zero searches | |
| AC-5 | verified | live | A synthetic English microphone in Chrome asked for progress on a real, running files-only research job. The host player started the synthesized reply, the original job completed, and the saved question and IDs matched. [Live evidence](1-pitch-studio.voice-evidence.json) | |
| AC-6 | verified | fixture | Chromium opened the file, checked two dated chart values and compared the downloaded Markdown with its displayed source | |
| AC-7 | verified | fixture | The browser and API closed during research. A fresh browser signed in, found the same project and opened the recovered result. The durable job completed once | |
| AC-8 | verified | fixture | Chrome denied microphone permission before the user typed the brief and completed the pitch in the same project | |
| AC-9 | verified | fixture | A second project supplied USD and EUR measurements. Its saved Markdown retained the evidence and withheld the incompatible chart | |
| AC-10 | unverified | none | Four Linux amd64 container images passed local HTTPS and database restart rehearsal. CloudFormation passed offline schema checks | Owner-approved AWS deployment, public TLS, fresh-device recovery and a real EBS snapshot restore |

Run the combined fixture from the repository root with Node 24, Bun and Chrome installed:

```sh
node --experimental-strip-types scripts/check-pitch-studio.ts
```

The fixture replaces research model calls, uses an isolated temporary database, and starts two local services. Physical-room speech and AWS performance are separate measurements. The [decision trail](1-pitch-studio.decisions.tsv) records the verification choices.

Owner decisions pending: production region and hostname, deployment approval, production spend and retention limits, and the launch language list after real-device checks.

## Next module plan

1. Rehearse the English, Hindi and mixed-language voice journey with a physical microphone and room speakers. Measure interruption and spoken progress round-trip time.
2. With deployment approval, deploy the tested image digests, rerun the customer journey on a second device, record CloudWatch latency and restore a snapshot to an isolated stack.
3. Module 2 can present an explicitly approved saved revision and reuse project ownership and the host audio controls.
