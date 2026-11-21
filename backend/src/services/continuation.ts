import type {
  TContinuationAction, TContinuationEvent, TContinuationRole, TContinuationState, TNextContinuation, TPointSpec,
} from "../types/continuation";

const roles: Record<TContinuationAction["kind"], TContinuationRole> = {
  play: "host", prepare: "host", interrupt: "host", cancel_demo: "host", skip: "host",
  revisit: "host", reconnect: "host", playout: "player", observed: "worker", paint: "stage",
};

export class ContinuationConflict extends Error {
  override name = "ContinuationConflict";
}

const require_condition: (value: unknown, reason: string) => asserts value = (value, reason) => {
  if (!value) throw new ContinuationConflict(reason);
};

export const create_continuation = (session_id: string, revision: number, points: TPointSpec[]): TContinuationState => {
  require_condition(points.length && new Set(points.map(p => p.point_id)).size === points.length, "Expected unique agenda points");
  return {
    session_id, revision, generation: 0, playback: null, preparation: null, used_attempts: [],
    points: points.map(p => ({ ...p, spoken: "pending", demo: "pending", skipped: false })),
  };
};

export const next_continuation = (state: TContinuationState): TNextContinuation => {
  for (const p of state.points) {
    if (p.skipped || (p.requirement === "either" && p.demo === "displayed")) continue;
    if (p.spoken !== "complete") return { kind: "speak", point_id: p.point_id };
    if (p.requirement === "both" && p.demo !== "displayed") {
      return { kind: p.demo === "blocked" ? "retry_or_skip" : "demo", point_id: p.point_id };
    }
  }
  return { kind: "done" };
};

const point = (state: TContinuationState, point_id: string) => {
  const found = state.points.find(p => p.point_id === point_id);
  require_condition(found, "Unknown agenda point");
  return found;
};

const stop_audio = (state: TContinuationState) => {
  if (state.playback) point(state, state.playback.point_id).spoken = "partial";
  state.playback = null;
};

export const apply_continuation = (current: TContinuationState, role: TContinuationRole, event: TContinuationEvent) => {
  require_condition(event.session_id === current.session_id && event.expected_revision === current.revision &&
    event.generation === current.generation, "Stale session, revision or generation");
  const a = event.action;
  require_condition(role === roles[a.kind], "Unauthorized evidence producer");
  const state = structuredClone(current);
  const audio = state.playback;
  const demo = state.preparation;
  if (a.kind === "play" || a.kind === "prepare") {
    const next = next_continuation(state);
    require_condition(next.kind !== "done" && next.point_id === a.point_id, "Point is not due");
    require_condition(!state.used_attempts.includes(a.attempt_id), "Attempt ID already used");
    state.used_attempts.push(a.attempt_id);
  }
  switch (a.kind) {
    case "play":
      require_condition(!audio && next_continuation(state).kind === "speak", "Speech unavailable");
      state.playback = { point_id: a.point_id, attempt_id: a.attempt_id, asset_id: a.asset_id };
      break;
    case "interrupt":
      require_condition(audio?.attempt_id === a.attempt_id, "Stale audio attempt");
      stop_audio(state);
      break;
    case "playout":
      require_condition(audio && audio.attempt_id === a.attempt_id && audio.asset_id === a.asset_id, "Stale audio or asset");
      point(state, audio.point_id).spoken = a.natural && a.certain ? "complete" : "partial";
      state.playback = null;
      break;
    case "prepare":
      require_condition(!demo && point(state, a.point_id).requirement !== "spoken", "Demo unavailable");
      state.preparation = { point_id: a.point_id, attempt_id: a.attempt_id, frame_id: null };
      break;
    case "observed":
      require_condition(demo && demo.attempt_id === a.attempt_id && !demo.frame_id, "Stale browser observation");
      if (a.outcome === "setup") {
        require_condition(a.frame_id, "Missing observed frame");
        demo.frame_id = a.frame_id;
      } else {
        require_condition(!a.frame_id, "Blocked observation cannot publish a frame");
        point(state, demo.point_id).demo = "blocked";
        state.preparation = null;
      }
      break;
    case "paint":
      require_condition(demo && demo.attempt_id === a.attempt_id && demo.frame_id === a.frame_id && a.visible, "Unverified stage frame");
      point(state, demo.point_id).demo = "displayed";
      state.preparation = null;
      break;
    case "cancel_demo":
      require_condition(demo?.attempt_id === a.attempt_id, "Stale demo attempt");
      state.preparation = null;
      break;
    case "skip":
    case "revisit": {
      const target = point(state, a.point_id);
      stop_audio(state);
      state.preparation = null;
      if (a.kind === "skip") target.skipped = true;
      else {
        target.skipped = false;
        target.spoken = "pending";
        target.demo = "pending";
      }
      break;
    }
    case "reconnect":
      stop_audio(state);
      state.preparation = null;
      state.generation += 1;
      break;
  }
  return state;
};
