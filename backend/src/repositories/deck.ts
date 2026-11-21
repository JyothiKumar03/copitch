import type { Database } from "bun:sqlite";
import { AppError } from "../errors/app-error";
import type { TDeck, TDeckPlanInput, TEditRequest, TEditProposal } from "../types/deck";
import type { TLiveReply, TLiveTurnInput, TLiveTurnContext } from "../types/live-turn";
import { estimate_pitch_seconds } from "../services/pitch";
import { propose_slide } from "../services/deck";

const pitch_variant_version = 3;
const context_slides_version = 5;

export const pitch_variant_key = (pitch?: TDeckPlanInput) => {
  if (!pitch) return "";
  if (!("duration_minutes" in pitch)) return JSON.stringify([context_slides_version, "context_slides", pitch.slide_count]);
  return JSON.stringify([pitch_variant_version, pitch.audience.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase(),
    pitch.duration_minutes, ...(pitch.slide_count || pitch.demo ? [pitch.slide_count ?? null, pitch.demo ?? null] : [])]);
};

export class DeckRepository {
  constructor(private db: Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS decks (
        id TEXT PRIMARY KEY, session TEXT NOT NULL, research TEXT NOT NULL, revision INTEGER NOT NULL,
        variant TEXT NOT NULL DEFAULT '', UNIQUE(session, research, variant));
      CREATE TABLE IF NOT EXISTS deck_revisions (
        deck TEXT NOT NULL, revision INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(deck, revision));
      CREATE TABLE IF NOT EXISTS deck_turns (
        deck TEXT NOT NULL, turn TEXT NOT NULL, revision INTEGER NOT NULL, request TEXT NOT NULL,
        reply TEXT NOT NULL, PRIMARY KEY(deck,turn));
      CREATE TABLE IF NOT EXISTS deck_proposals (
        id TEXT PRIMARY KEY, deck TEXT NOT NULL, command TEXT NOT NULL, request TEXT NOT NULL,
        payload TEXT NOT NULL, UNIQUE(deck, command));
    `);
    db.transaction(() => {
      const columns = db.query<{ name: string }, []>("PRAGMA table_info(decks)").all();
      if (columns.some(column => column.name === "variant")) return;
      // Every child record points to the immutable deck ID. Preserve those IDs while widening the unique key.
      db.exec(`
        CREATE TABLE decks_with_variants (
          id TEXT PRIMARY KEY, session TEXT NOT NULL, research TEXT NOT NULL, revision INTEGER NOT NULL,
          variant TEXT NOT NULL DEFAULT '', UNIQUE(session, research, variant));
        INSERT INTO decks_with_variants(id,session,research,revision)
          SELECT id,session,research,revision FROM decks;
        DROP TABLE decks;
        ALTER TABLE decks_with_variants RENAME TO decks;
      `);
    }).immediate();
  }

  for_research(session: string, research: string, variant = ""): TDeck | undefined {
    const row = this.db.query<{id: string}, [string,string,string]>(
      "SELECT id FROM decks WHERE session=? AND research=? AND variant=?").get(session, research, variant);
    return row ? this.get(session, row.id) : undefined;
  }

  variants(session: string, research: string) {
    return this.db.query<{ payload: string }, [string,string]>(`
      SELECT r.payload FROM decks d JOIN deck_revisions r ON r.deck=d.id AND r.revision=d.revision
      WHERE d.session=? AND d.research=? ORDER BY d.rowid DESC LIMIT 100`).all(session, research).map(row => {
      const deck = JSON.parse(row.payload) as TDeck;
      const label = deck.pitch?.audience ? `${deck.pitch.audience} · ${deck.pitch.duration_minutes} min` :
        deck.pitch?.slide_count ? `${deck.slides.length} ${deck.slides.length === 1 ? "slide" : "slides"}` : deck.title;
      return { deck_id: deck.deck_id, label };
    });
  }

  create(session: string, snapshot: TDeck, variant = ""): TDeck {
    return this.db.transaction(() => {
      const existing = this.for_research(session, snapshot.research_id, variant);
      if (existing) return existing;
      this.db.query("INSERT INTO decks(id,session,research,revision,variant) VALUES(?,?,?,?,?)")
        .run(snapshot.deck_id, session, snapshot.research_id, snapshot.revision, variant);
      this.save_revision(snapshot);
      return snapshot;
    }).immediate();
  }

  reorder(session: string, id: string, base_revision: number, slide_ids: string[]): TDeck {
    return this.db.transaction(() => {
      const deck = this.get(session, id);
      if (!deck) throw new AppError(404, "Unknown deck");
      const base = this.get(session, id, base_revision);
      if (!base) throw new AppError(409, "Unknown base revision");
      const by_id = new Map(base.slides.map(slide => [slide.slide_id, slide]));
      if (slide_ids.length !== by_id.size || new Set(slide_ids).size !== by_id.size ||
          !slide_ids.every(key => by_id.has(key))) throw new AppError(400, "Include every slide exactly once");
      const snapshot = { ...base, slides: slide_ids.map(key => by_id.get(key)!), revision: base_revision + 1, render_review: undefined };
      if (deck.revision !== base_revision) {
        const saved = this.get(session, id, snapshot.revision);
        if (saved && JSON.stringify(saved) === JSON.stringify(snapshot)) return saved;
        throw new AppError(409, "Slide order is based on an older revision");
      }
      if (base.slides.every((slide, i) => slide.slide_id === slide_ids[i])) return base;
      this.save_revision(snapshot);
      this.db.query("UPDATE decks SET revision=? WHERE id=?").run(snapshot.revision, id);
      return snapshot;
    }).immediate();
  }

  private save_revision(snapshot: TDeck) {
    this.db.query("INSERT INTO deck_revisions VALUES(?,?,?)").run(snapshot.deck_id, snapshot.revision, JSON.stringify(snapshot));
  }

  get(session: string, deck: string, revision?: number): TDeck | undefined {
    const row = this.db.query<{payload: string}, [number|null,string,string]>(`
      SELECT r.payload FROM decks d JOIN deck_revisions r ON r.deck=d.id
      AND r.revision=COALESCE(?,d.revision) WHERE d.id=? AND d.session=?`).get(revision ?? null,deck,session);
    if (row) return JSON.parse(row.payload) as TDeck;
  }

  cached_turn(session: string, deck: string, input: TLiveTurnInput): TLiveReply | undefined {
    const row = this.db.query<{request: string; reply: string}, [string,string,string]>(`
      SELECT t.request,t.reply FROM deck_turns t JOIN decks d ON t.deck=d.id
      WHERE d.session=? AND t.deck=? AND t.turn=?`).get(session,deck,input.turn_id);
    if (!row) return;
    if (row.request !== JSON.stringify(input)) throw new AppError(409, "Turn ID already identifies another request");
    const reply = JSON.parse(row.reply) as TLiveReply;
    if (reply.kind === "edit") {
      reply.proposal = this.proposal(session,deck,reply.proposal.proposal_id) ?? reply.proposal;
    }
    return reply;
  }

  recent_turns(session: string, deck: string, revision: number): TLiveTurnContext["recent_turns"] {
    const rows = this.db.query<{request:string;reply:string}, [string,string,number]>(`
      SELECT t.request,t.reply FROM deck_turns t JOIN decks d ON t.deck=d.id
      WHERE d.session=? AND t.deck=? AND t.revision=? ORDER BY t.rowid DESC LIMIT 2`).all(session,deck,revision);
    return rows.reverse().map(row => ({
      message: (JSON.parse(row.request) as TLiveTurnInput).message.slice(0,400),
      response: (JSON.parse(row.reply) as TLiveReply).text.slice(0,400),
    }));
  }

  finish_turn(session: string, deck: string, input: TLiveTurnInput, prepare: () => TLiveReply): TLiveReply {
    return this.db.transaction(() => {
      if (this.get(session,deck)?.revision !== input.base_revision) throw new AppError(409, "Deck changed while handling this turn");
      const cached = this.cached_turn(session,deck,input);
      if (cached) return cached;
      const reply = prepare();
      this.db.query("INSERT INTO deck_turns VALUES(?,?,?,?,?)")
        .run(deck,input.turn_id,input.base_revision,JSON.stringify(input),JSON.stringify(reply));
      return reply;
    })();
  }

  proposal(session: string, deck: string, id: string): TEditProposal | undefined {
    const row = this.db.query<{payload: string}, [string,string,string]>(`
      SELECT p.payload FROM deck_proposals p JOIN decks d ON d.id=p.deck
      WHERE d.session=? AND d.id=? AND p.id=?`).get(session,deck,id);
    if (row) return JSON.parse(row.payload) as TEditProposal;
  }

  propose(session: string, deck: string, request: TEditRequest, linked?: { attribution: NonNullable<TEditProposal["attribution"]>; sources: NonNullable<TDeck["sources"]> }): TEditProposal {
    return this.db.transaction(() => {
      const current = this.get(session,deck);
      if (!current) throw new AppError(404, "Unknown deck");
      const prior = this.db.query<{request: string; payload: string}, [string,string]>(
        "SELECT request,payload FROM deck_proposals WHERE deck=? AND command=?").get(deck, request.command_id);
      // The controller normalizes field order using the edit schema before dispatch.
      const signature = JSON.stringify(linked ? { request, linked } : request);
      if (prior) {
        if (prior.request !== signature) throw new AppError(409, "Command ID already identifies a different edit");
        return JSON.parse(prior.payload) as TEditProposal;
      }
      if (request.base_revision !== current.revision) throw new AppError(409, "Deck revision changed");
      const before = current.slides.find(slide => slide.slide_id === request.slide_id);
      if (!before) throw new AppError(404, "Unknown slide");
      const proposal_id = crypto.randomUUID();
      const after = propose_slide(before, request.changes);
      const sources_added = linked && [...linked.sources, ...linked.attribution.some(item => item.evidence_id === "host")
        ? [{ id: "H-LIVE-" + proposal_id, origin: "host" as const, location: "Host-supplied during presentation" }] : []];
      if (sources_added?.length) {
        const ids = sources_added.map(source => source.id);
        after.evidence_ids = [...new Set([...after.evidence_ids, ...ids])];
        const previous = new Set(before.sentences?.map(sentence => sentence.sentence_id));
        for (const sentence of after.sentences ?? []) if (!previous.has(sentence.sentence_id)) {
          sentence.evidence_ids = [...new Set([...sentence.evidence_ids, ...ids])];
        }
      }
      const proposal: TEditProposal = { proposal_id, deck_id: deck, base_revision: current.revision, slide_id: before.slide_id,
        before, after, status: "pending", approved_revision: null, ...(linked && { attribution: linked.attribution, sources_added }) };
      this.db.query("INSERT INTO deck_proposals VALUES(?,?,?,?,?)")
        .run(proposal.proposal_id, deck, request.command_id, signature, JSON.stringify(proposal));
      return proposal;
    })();
  }

  decide(session: string, deck: string, id: string, decision: "approve" | "reject"): TEditProposal {
    return this.db.transaction(() => {
      const proposal = this.proposal(session,deck,id);
      if (!proposal) throw new AppError(404, "Unknown proposal");
      const status = decision === "approve" ? "approved" : "rejected";
      if (proposal.status === status) return proposal;
      if (proposal.status !== "pending") throw new AppError(409, "Proposal was already decided");
      if (decision === "approve") {
        const current = this.get(session,deck)!;
        if (current.revision !== proposal.base_revision) throw new AppError(409, "Edit is based on an older revision");
        const revision = current.revision + 1;
        const slides = current.slides.map(slide => slide.slide_id === proposal.slide_id ? proposal.after : slide);
        const pitch = current.pitch && { ...current.pitch, estimated_seconds: estimate_pitch_seconds(slides) + (current.pitch.demo?.seconds ?? 0) };
        const sources = proposal.sources_added?.length && [...new Map([...(current.sources ?? []), ...proposal.sources_added].map(source => [source.id, source])).values()];
        this.save_revision({ ...current, revision, slides, render_review: undefined, ...(pitch && { pitch }), ...(sources && { sources }) });
        this.db.query("UPDATE decks SET revision=? WHERE id=?").run(revision,deck);
        proposal.approved_revision = revision;
      }
      proposal.status = status;
      this.db.query("UPDATE deck_proposals SET payload=? WHERE id=?").run(JSON.stringify(proposal),id);
      return proposal;
    })();
  }
}
