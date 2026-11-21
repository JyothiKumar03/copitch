import type { Response } from "express";
import type { TApiRequest } from "../types/http";
import { AppError } from "../errors/app-error";
import { database } from "../repositories/store";
import { session_for } from "../middleware/host-session";
import { edit_input } from "../services/deck";
import { check_live_answer, classify_live_turn, live_context, live_input } from "../services/live-turn";
import type { TLiveModel, TLiveReply } from "../types/live-turn";

export const live_turn_handler = (model: TLiveModel = classify_live_turn) => {
  const pending = new Map<string, { signature: string; result: Promise<TLiveReply> }>();
  return async (req: TApiRequest, res: Response) => {
    const session = session_for(req);
    if (!session) return res.status(401).json({ error: "Unauthorized" });
    const parsed = live_input.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid live turn" });
    const input = parsed.data;
    const db = database();
    const id = req.params.deck_id;
    const deck = db.decks.get(session,id);
    if (!deck) return res.status(404).json({ error: "Unknown deck" });
    if (deck.revision !== input.base_revision) return res.status(409).json({ error: "Deck revision changed" });
    const cached = db.decks.cached_turn(session,id,input);
    if (cached) return res.json(cached);
    const slide = deck.slides.find(slide => slide.slide_id === input.slide_id);
    if (!slide) return res.status(404).json({ error: "Unknown slide" });
    const key = JSON.stringify([session,id,input.turn_id]);
    const signature = JSON.stringify(input);
    const running = pending.get(key);
    if (running) {
      if (running.signature !== signature) return res.status(409).json({ error: "Turn ID already in use" });
      return res.json(await running.result);
    }
    const research = db.research_for_deck(session, deck);
    if (!research) return res.status(409).json({ error: "Deck research is unavailable" });
    const context = live_context(deck,slide,input,research,db.decks.recent_turns(session,id,deck.revision));
    const result = model(context,AbortSignal.timeout(30000)).then(decision => db.decks.finish_turn(session,id,input,() => {
      const checked = check_live_answer(decision,context);
      if (checked.kind === "control" || checked.kind === "ignore") return { kind: "clarify", text: "Use the presentation controls for this action." };
      if (checked.kind !== "edit") return checked;
      const edit = edit_input.safeParse({ base_revision: input.base_revision, command_id: crypto.randomUUID(),
        slide_id: input.slide_id, changes: checked.changes });
      if (!edit.success) throw new AppError(502, "Model returned an invalid slide edit");
      return { kind: "edit", text: checked.text, proposal: db.decks.propose(session,id,edit.data) };
    })).finally(() => pending.delete(key));
    pending.set(key, { signature,result });
    return res.json(await result);
  };
};
