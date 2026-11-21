type TCallbacks = {
  onInterim: (text: string) => void;
  onFinal: (text: string, turnId: string) => void;
  onWarning: (message: string) => void;
};
type TItem = { id: string; turnId: string; interim: string; final?: string; committed: boolean; updated: number };
const maxChars = 6000;
const maxPending = 24;
const maxAge = 60000;
const hasSupportedScript = (text: string) => !/\p{L}/u.test(text) || /[\p{Script=Latin}\p{Script=Devanagari}]/u.test(text);

export const createRealtimeTurns = (callbacks: TCallbacks) => {
  const pending = new Map<string, TItem>();
  const committed: string[] = [];
  const finished = new Set<string>();
  const seenDeltas = new Set<string>();
  const remember = (set: Set<string>, id: string, limit: number) => {
    set.add(id);
    if (set.size > limit) set.delete(set.values().next().value!);
  };
  const showInterim = () => {
    const active = [...pending.values()].findLast(item => item.final === undefined && item.interim);
    callbacks.onInterim(active && hasSupportedScript(active.interim) ? active.interim : "");
  };
  const forget = (id: string) => {
    pending.delete(id);
    remember(finished, id, 256);
  };
  const drain = () => {
    while (committed.length) {
      const item = pending.get(committed[0]);
      if (item && item.final === undefined) break;
      committed.shift();
      if (item) {
        forget(item.id);
        if (item.final) callbacks.onFinal(item.final, item.turnId);
      }
    }
    showInterim();
  };
  const expire = () => {
    let dropped = false;
    for (const item of pending.values()) {
      if (Date.now() - item.updated <= maxAge) continue;
      forget(item.id); dropped = true;
    }
    if (dropped) {
      drain();
      callbacks.onWarning("A voice turn timed out. Please repeat that part or type it.");
    }
  };
  const handle = (event: Record<string, unknown>) => {
    const id = event.item_id;
    if (typeof id !== "string" || !id || id.length > 256 || finished.has(id)) return;
    const type = event.type;
    if (type !== "input_audio_buffer.committed" && type !== "conversation.item.input_audio_transcription.delta" &&
        type !== "conversation.item.input_audio_transcription.completed" && type !== "conversation.item.input_audio_transcription.failed") return;
    if (type === "conversation.item.input_audio_transcription.failed") {
      forget(id); drain(); callbacks.onWarning("That voice turn could not be transcribed. Please repeat it or type it."); return;
    }
    let item = pending.get(id);
    if (!item) {
      if (pending.size >= maxPending) {
        forget(pending.keys().next().value!); drain();
        callbacks.onWarning("Voice is receiving more turns than it can process. Please repeat any missing message.");
      }
      item = { id, turnId: crypto.randomUUID(), interim: "", committed: false, updated: Date.now() };
      pending.set(id, item);
    }
    item.updated = Date.now();
    if (type === "input_audio_buffer.committed" && !item.committed) {
      item.committed = true; committed.push(id);
    } else if (type === "conversation.item.input_audio_transcription.delta" && typeof event.delta === "string" && item.final === undefined) {
      if (typeof event.event_id === "string") {
        if (seenDeltas.has(event.event_id)) return;
        remember(seenDeltas, event.event_id, 512);
      }
      item.interim = (item.interim + event.delta).slice(0, maxChars);
    } else if (type === "conversation.item.input_audio_transcription.completed" && typeof event.transcript === "string") {
      const text = event.transcript.trim();
      if (text.length > maxChars) {
        callbacks.onWarning("That voice turn was too long. Please split it into shorter messages."); item.final = "";
      } else if (!hasSupportedScript(text)) {
        callbacks.onWarning("I couldn’t recognize that in English or Hindi. Please repeat it or type it."); item.final = "";
      } else item.final = text;
    }
    drain();
  };
  return { handle, expire };
};
