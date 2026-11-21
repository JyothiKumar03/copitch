# Studio turns and research approval

Module 1 is a private conversation that creates a source-backed pitch. The center of the desktop workspace holds the conversation, attached files, the research plan and saved pitch. The agent and voice controls sit on the right. Reopening a project restores saved work with the microphone off. [Module 1 acceptance contract](../handoffs/1-pitch-studio.contract.md)

## A turn has one controller

A typed turn sends the host's message to Express. One purpose-scoped model call returns a reply, BCP-47 language, proposed memory updates and an intent. A plan includes the topic, audience, purpose and proposed search scope. A file answer identifies the excerpts that support the reply. Express validates the result, filters actions by phase, and commits accepted changes and the reply together. The message offering research includes the saved plan. [Structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs)

For voice, Express authorizes a project-bound OpenAI Live call. The trusted sideband observes finalized host text and the provider's structured proposal, then applies it through the same phase controller. It voices the saved reply. Transcript partials remain display state. Browser messages do not select actions or submit provider tool results. [Voice protocol](voice-architecture.md)

| Phase | Controller behavior |
|---|---|
| Interview | Keep a specific goal and factual notes. Ask one material follow-up at a time. A greeting does not reset the brief. |
| Proposed | Show the saved plan, sources and scope. Accept a valid current approval, or return to the interview to change it. |
| Researching | Maintain one job for the approved revision. The host can type a side question while it runs. The agent gives one closing line and ends voice when research starts. |
| Done | Restore the saved artifact or the job's terminal outcome. A later host instruction can shape another plan. |

The next reply follows an explicit language preference or the language of the latest host turn. A model error leaves the saved scope and proposal intact and returns a retry reply. The conversation records no reasoning text.

## Research requires the current plan

A host can select **Start research** on a current proposal, or speak an unqualified affirmative after hearing its full reply. The trusted voice path records which proposal and originating reply finished playing and captures that state when the host starts speaking. An approval spoken before completion cannot use a later playback event. An interruption, replacement or stale proposal ID leaves research unstarted. Other languages remain available for conversation. When the controller cannot recognize a spoken approval, the visible approval stays available.

A replay with the same turn identity returns the saved outcome. Changed input under that identity is rejected. Express persists the reviewed brief and enqueues its leased job in one transaction. Research keeps its own lifetime across browser exits and retries. Source selection before voice uses an authenticated scope update, with no model call or synthetic conversation turn.

## Evidence controls publication

An uploaded file becomes usable after its parser returns authorized source records. File replies carry exact excerpts with their PDF page, PowerPoint slide or CSV row. Invalid excerpts are withheld. Unsupported and unavailable files surface their own outcomes.

Research uses the reviewed plan. The worker tracks candidate search results and direct page reads separately. Only a page read can contribute public evidence. Files-only work skips external retrieval. With sufficient evidence the worker saves verified findings and cited sources. Comparable cited values can render as a chart. The download and preview point to the same saved revision. [Research worker](../backend/src/workers/research.ts)

## Cases to verify

| Host's action | Expected observation |
|---|---|
| Sign in, open a project and greet the agent | The agent asks what to pitch. Reopening restores the project and transcript. A different account cannot read it. |
| Give a vague answer, then explain the goal in more detail | The next question changes with the answer. Specific intent and factual notes replace the need for repeated fixed-slot prompts. |
| Speak Telugu, then request a different reply language | The original text is retained. The new preference controls subsequent replies. Verify voice playout separately from the text tag. |
| Give the audience and purpose of a pitch or personal introduction | A proposal card appears with a plan the host can review. An introduction can help listeners understand the host’s role without asking for a decision. A file name stays a source. |
| Ask about a selected attachment, then ask about an unavailable one | A supported reply cites actual source records. Missing evidence is reported without an invented answer. |
| Answer an interrupted proposal, then approve a complete one | The first response creates no job. The exact selected option or an unqualified spoken affirmative after completion creates one job. |
| Change the goal or source while a proposal is open | The prior proposal becomes stale. Its approval cannot launch a job. |
| Ask a status question during research, disconnect, and sign in again | The same job and saved project return, with voice off. |
| Allow a public page with useful facts, then try one with no usable evidence | The first can support a draft after a recorded read. The second leaves the project in needs input, with no final pitch file. |
| Open and download a finished pitch | The source links, valid chart and speakable text belong to the saved revision. |

## Verification boundaries

The phase and controller fixtures cover accepted and rejected actions, legacy state, a duplicate turn, file excerpts and preference restore. The model fixture checks one structured request. The provider rehearsal separately checks natural interview replies and planning with synthetic input. Browser voice, physical microphones, and the hosted return journey require their own evidence. [Controller fixtures](../backend/tests/studio-turn.test.ts) · [Model fixture](../backend/tests/studio-agent.test.ts) · [Conversation eval](../simulations/studio/conversation_eval.ts)
