import { request } from "./research";
import type { TResearchProposal, TResearchSession, TResearchWorkspace, TStudioSources, TSourceCall, TTurnInput } from "@/types/research";

const validProposal = (proposal: TResearchProposal | null) => proposal == null || (
  typeof proposal.proposal_id === "string" && typeof proposal.summary === "string" &&
  Array.isArray(proposal.queries) && proposal.queries.every(query => typeof query === "string") &&
  Array.isArray(proposal.urls) && proposal.urls.every(url => typeof url === "string") &&
  ["files_only", "public_search"].includes(proposal.source_policy)
);

export const sendStudioTurn = async (session: TResearchSession, input: TTurnInput) => {
  const path = `/api/sessions/${encodeURIComponent(session.session_id)}/interview/turn`;
  const value = await (await request(path, session, input)).json();
  if (value?.turn_id !== input.turn_id || typeof value.text !== "string" || typeof value.language !== "string" || !/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(value.language) ||
      !["interview", "proposed", "researching", "done"].includes(value.phase) || !validProposal(value.proposal) ||
      (value.phase === "proposed" && !value.proposal) || !["interview", "proposed", "researching", "done"].includes(value.workspace?.phase) ||
      !validProposal(value.workspace?.proposal) || (value.workspace.phase === "proposed" && !value.workspace.proposal) ||
      !Array.isArray(value.workspace?.history) || !value.workspace.history.every((item: { role?: unknown; text?: unknown } | null) =>
        item && (item.role === "host" || item.role === "assistant") && typeof item.text === "string")) {
    throw new Error("The reply could not be read. Retry this message.");
  }
  return { text: value.text as string, language: value.language, workspace: value.workspace as TResearchWorkspace };
};

export const applyStudioSources = async (session: TResearchSession, scope: TStudioSources): Promise<TResearchWorkspace> => {
  const path = `/api/sessions/${encodeURIComponent(session.session_id)}/interview/sources`;
  const { workspace } = await (await request(path, session, scope)).json();
  if (!workspace?.state || !Array.isArray(workspace.state.source_ids) || !Array.isArray(workspace.history)) {
    throw new Error("The updated sources could not be read. Refresh the project and try again.");
  }
  return workspace;
};

export const fetchSourceCalls = async (session: TResearchSession, signal: AbortSignal): Promise<TSourceCall[]> => {
  const path = `/api/sessions/${encodeURIComponent(session.session_id)}/research/source-calls`;
  const value = await (await request(path, session, undefined, { signal })).json();
  if (!Array.isArray(value?.calls) || !value.calls.every((call: TSourceCall | null) => call && typeof call.call_id === "string" &&
      typeof call.filename === "string" && ["parse_pdf", "parse_csv", "parse_ppt", "parse_pptx"].includes(call.tool) &&
      ["running", "succeeded", "failed"].includes(call.status))) throw new Error("File activity is unavailable.");
  return value.calls;
};
