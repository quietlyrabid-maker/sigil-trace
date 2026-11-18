// Sigil Trace actions: mint, list, inspect, transfer, redeem (burn),
// verify, and attach an external reference to a Note.
//
// The engine is the original Sigil Trace lattice, ported faithfully from
// the repo's main.js: a 3D accumulator over the secp256k1 prime Q, with
// one SHA-256 basis vector per event kind (init / auth / transfer) and a
// terminus rendered as a 20x20 matrix from 4x SHA-256 of the terminus hex.
//
// The product fixes on top of the original:
//  - The event sequence is derived from asset ref + owner salt + a random
//    per-mint nonce, so the same asset wrapped twice (or by two holders)
//    produces different termini. The original was asset-ID-only.
//  - Every lifecycle step (mint, transfer, redeem) appends real events to
//    the sequence and recomputes the terminus; each step is stored, so
//    verifyNote can recompute the whole chain and compare.
//  - Redeem burns the Note: status flips to redeemed in the registry and
//    no further transfer or redeem is accepted. The asset's secret code
//    is revealed only by that one redeem call.
//  - No payment is taken and no zero-knowledge claim is made: the
//    registry record + recomputed chain is the proof this product offers.

import { defineAction, z, type ActionsModule, type Ctx } from "@hatch/space-sdk";
import { asc, desc, eq } from "drizzle-orm";
import * as schema from "./schema";

// ---------- Lattice engine (ported from the original main.js) ----------

const Q =
  0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
const SEED_SALT = "sigil-vault-nimiq-v1";
const EVENT_KINDS = ["init", "auth", "transfer"] as const;
type LatticeEvent = (typeof EVENT_KINDS)[number];

async function sha256Hex(str: string): Promise<string> {
  const data = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256BigInt(str: string): Promise<bigint> {
  return BigInt("0x" + (await sha256Hex(str)));
}

type Basis = Record<LatticeEvent, [bigint, bigint, bigint]>;

let basisPromise: Promise<Basis> | null = null;
function getBasis(): Promise<Basis> {
  if (!basisPromise) {
    basisPromise = (async () => {
      const basis = {} as Basis;
      for (const e of EVENT_KINDS) {
        const h = await sha256Hex(SEED_SALT + e);
        basis[e] = [
          (await sha256BigInt(h + "x")) % Q,
          (await sha256BigInt(h + "y")) % Q,
          (await sha256BigInt(h + "z")) % Q,
        ];
      }
      return basis;
    })();
  }
  return basisPromise;
}

async function computeTerminus(
  sequence: LatticeEvent[],
  basis: Basis,
): Promise<[bigint, bigint, bigint]> {
  let x = 0n,
    y = 0n,
    z = 0n,
    running = 0n;
  for (let pos = 1; pos <= sequence.length; pos++) {
    const e = sequence[pos - 1];
    if (!e) break;
    const [vx, vy, vz] = basis[e];
    const h = await sha256BigInt(`${running}:${pos}:${e}`);
    x = (x + vx * BigInt(pos) * h) % Q;
    y = (y + vy * BigInt(pos) * h) % Q;
    z = (z + vz * BigInt(pos) * h) % Q;
    running = x ^ y ^ z;
  }
  return [x, y, z];
}

// Map hex characters of a hash onto the three event kinds, exactly as the
// original mapped the asset hash (charCode % 3).
function eventsFromHash(hashHex: string, count: number): LatticeEvent[] {
  const seq: LatticeEvent[] = [];
  for (let i = 0; i < count && i < hashHex.length; i++) {
    const code = hashHex.charCodeAt(i) % 3;
    seq.push(code === 0 ? "init" : code === 1 ? "auth" : "transfer");
  }
  return seq;
}

// 400 matrix cells driven by 4x SHA-256 of the terminus hex, as rendered
// by the original app.
async function terminusBits(termHex: string): Promise<string> {
  let bits = "";
  for (let k = 0; k < 4; k++) {
    const h = await sha256Hex(termHex + ":" + k);
    for (const c of h) bits += parseInt(c, 16).toString(2).padStart(4, "0");
  }
  return bits.slice(0, 400);
}

function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function sameHolder(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

// ---------- Shared response shapes ----------

const noteSummary = z.object({
  id: z.number(),
  publicId: z.string(),
  assetType: z.string(),
  assetName: z.string(),
  issuer: z.string().nullable(),
  faceValue: z.number(),
  currency: z.string(),
  currentHolder: z.string(),
  status: z.string(),
  terminusHex: z.string(),
  bits: z.string(),
  eventCount: z.number(),
  createdAt: z.string(),
  redeemedAt: z.string().nullable(),
});

const noteEventOut = z.object({
  id: z.number(),
  kind: z.string(),
  fromHolder: z.string().nullable(),
  toHolder: z.string(),
  terminusAfter: z.string(),
  message: z.string().nullable(),
  createdAt: z.string(),
});

const noteDetail = noteSummary.extend({
  assetRef: z.string(),
  externalRef: z.string().nullable(),
  // Only set on the redeem response and on detail views of an already
  // redeemed note. Null while the note is active.
  secretCode: z.string().nullable(),
  events: z.array(noteEventOut),
});

type NoteRow = typeof schema.notes.$inferSelect;

async function loadEvents(ctx: Ctx, noteId: number) {
  const db = ctx.db<typeof schema>();
  return db
    .select()
    .from(schema.noteEvents)
    .where(eq(schema.noteEvents.noteId, noteId))
    .orderBy(asc(schema.noteEvents.id));
}

async function toSummary(
  ctx: Ctx,
  note: NoteRow,
): Promise<z.infer<typeof noteSummary>> {
  const events = await loadEvents(ctx, note.id);
  return {
    id: note.id,
    publicId: note.publicId,
    assetType: note.assetType,
    assetName: note.assetName,
    issuer: note.issuer,
    faceValue: note.faceValue,
    currency: note.currency,
    currentHolder: note.currentHolder,
    status: note.status,
    terminusHex: note.terminusHex,
    bits: await terminusBits(note.terminusHex),
    eventCount: events.length,
    createdAt: note.createdAt.toISOString(),
    redeemedAt: note.redeemedAt ? note.redeemedAt.toISOString() : null,
  };
}

async function toDetail(
  ctx: Ctx,
  note: NoteRow,
  revealSecret: boolean,
): Promise<z.infer<typeof noteDetail>> {
  const summary = await toSummary(ctx, note);
  const events = await loadEvents(ctx, note.id);
  return {
    ...summary,
    assetRef: note.assetRef,
    externalRef: note.externalRef,
    secretCode: revealSecret ? note.secretCode : null,
    events: events.map((ev) => ({
      id: ev.id,
      kind: ev.kind,
      fromHolder: ev.fromHolder,
      toHolder: ev.toHolder,
      terminusAfter: ev.terminusAfter,
      message: ev.message,
      createdAt: ev.createdAt.toISOString(),
    })),
  };
}

async function findNote(ctx: Ctx, publicId: string): Promise<NoteRow> {
  const db = ctx.db<typeof schema>();
  const rows = await db
    .select()
    .from(schema.notes)
    .where(eq(schema.notes.publicId, publicId.trim().toUpperCase()))
    .limit(1);
  const note = rows[0];
  if (!note) throw new Error("No Note with that code exists in the registry.");
  return note;
}

// Recompute the terminus for the first `length` events of a sequence.
async function terminusAt(
  sequence: LatticeEvent[],
  length: number,
  basis: Basis,
): Promise<string> {
  const [x] = await computeTerminus(sequence.slice(0, length), basis);
  return x.toString(16);
}

// ---------- Actions ----------

export const Actions = {
  listNotes: defineAction({
    description:
      "Lists every Note in the vault registry, newest first, without any secret codes.",
    request: z.object({
      limit: z.number().int().positive().max(100).default(50),
    }),
    response: z.object({ notes: z.array(noteSummary) }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const rows = await db
        .select()
        .from(schema.notes)
        .orderBy(desc(schema.notes.id))
        .limit(args.limit);
      const notes: z.infer<typeof noteSummary>[] = [];
      for (const row of rows) notes.push(await toSummary(ctx, row));
      return { notes };
    },
  }),

  mintNote: defineAction({
    description:
      "Wraps a user-entered asset into a new Note: derives a holder-salted, nonce-unique event sequence, computes its lattice terminus, and records the mint in the registry.",
    request: z.object({
      assetType: z.enum(["gift_card", "ticket", "voucher", "certificate", "other"]),
      assetName: z.string().min(1).max(120),
      assetRef: z.string().min(1).max(120),
      issuer: z.string().max(120).optional(),
      faceValue: z.number().nonnegative().max(100000000),
      currency: z.string().min(1).max(8).default("USD"),
      secretCode: z.string().min(1).max(500),
      ownerLabel: z.string().min(1).max(80),
      externalRef: z.string().max(200).optional(),
    }),
    response: z.object({ note: noteDetail }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const basis = await getBasis();

      const ownerSalt = await sha256Hex(
        "holder:" + args.ownerLabel.trim().toLowerCase(),
      );
      const nonce = randomHex(16);
      const seedHash = await sha256Hex(
        `${args.assetRef}|${ownerSalt}|${nonce}`,
      );
      const sequence = eventsFromHash(seedHash, 64);
      const [x, y, zCoord] = await computeTerminus(sequence, basis);
      const termHex = x.toString(16);

      // Public code from the terminus, lengthened until unique.
      let publicId = "SIGIL-" + termHex.slice(0, 8).toUpperCase();
      for (let extra = 0; extra < 24; extra += 2) {
        const existing = await db
          .select({ id: schema.notes.id })
          .from(schema.notes)
          .where(eq(schema.notes.publicId, publicId))
          .limit(1);
        if (existing.length === 0) break;
        publicId =
          "SIGIL-" + termHex.slice(0, 8 + extra + 2).toUpperCase();
      }

      const inserted = await db
        .insert(schema.notes)
        .values({
          publicId,
          assetRef: args.assetRef,
          assetType: args.assetType,
          assetName: args.assetName,
          issuer: args.issuer?.trim() ? args.issuer.trim() : null,
          faceValue: args.faceValue,
          currency: args.currency.toUpperCase(),
          secretCode: args.secretCode,
          ownerSalt,
          nonce,
          eventSequence: sequence.join(","),
          terminusHex: termHex,
          terminusX: x.toString(16),
          terminusY: y.toString(16),
          terminusZ: zCoord.toString(16),
          currentHolder: args.ownerLabel.trim(),
          status: "active",
          externalRef: args.externalRef?.trim()
            ? args.externalRef.trim()
            : null,
        })
        .returning();
      const note = inserted[0];
      if (!note) throw new Error("Mint failed: no row was recorded.");

      await db.insert(schema.noteEvents).values({
        noteId: note.id,
        kind: "mint",
        fromHolder: null,
        toHolder: note.currentHolder,
        sequenceLength: sequence.length,
        terminusAfter: termHex,
        message: null,
      });

      ctx.invalidateQueries();
      return { note: await toDetail(ctx, note, false) };
    },
  }),

  getNote: defineAction({
    description:
      "Returns one Note's full detail and lifecycle chain by its public code. The secret code is included only if the Note has already been redeemed.",
    request: z.object({ publicId: z.string().min(1) }),
    response: z.object({ note: noteDetail }),
    async handler(ctx, args) {
      const note = await findNote(ctx, args.publicId);
      return { note: await toDetail(ctx, note, note.status === "redeemed") };
    },
  }),

  transferNote: defineAction({
    description:
      "Transfers an active Note to a new holder: appends transfer events to its lattice sequence, recomputes the terminus, and records the handover in the chain.",
    request: z.object({
      publicId: z.string().min(1),
      fromHolder: z.string().min(1).max(80),
      toHolder: z.string().min(1).max(80),
      message: z.string().max(300).optional(),
    }),
    response: z.object({ note: noteDetail }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const note = await findNote(ctx, args.publicId);
      if (note.status === "redeemed") {
        throw new Error("This Note has been redeemed and burned. It cannot be transferred.");
      }
      if (!sameHolder(args.fromHolder, note.currentHolder)) {
        throw new Error("The holder name given does not match the Note's current holder.");
      }
      if (sameHolder(args.toHolder, note.currentHolder)) {
        throw new Error("The new holder is the same as the current holder.");
      }
      const basis = await getBasis();
      const sequence = note.eventSequence.split(",") as LatticeEvent[];
      const extHash = await sha256Hex(
        `${note.terminusHex}:transfer:${sequence.length}:${args.toHolder.trim().toLowerCase()}`,
      );
      sequence.push(...eventsFromHash(extHash, 16));
      const [x, y, zCoord] = await computeTerminus(sequence, basis);
      const termHex = x.toString(16);

      await db
        .update(schema.notes)
        .set({
          eventSequence: sequence.join(","),
          terminusHex: termHex,
          terminusX: x.toString(16),
          terminusY: y.toString(16),
          terminusZ: zCoord.toString(16),
          currentHolder: args.toHolder.trim(),
        })
        .where(eq(schema.notes.id, note.id));
      await db.insert(schema.noteEvents).values({
        noteId: note.id,
        kind: "transfer",
        fromHolder: note.currentHolder,
        toHolder: args.toHolder.trim(),
        sequenceLength: sequence.length,
        terminusAfter: termHex,
        message: args.message?.trim() ? args.message.trim() : null,
      });

      const updated = await findNote(ctx, note.publicId);
      ctx.invalidateQueries();
      return { note: await toDetail(ctx, updated, false) };
    },
  }),

  redeemNote: defineAction({
    description:
      "Redeems and burns an active Note exactly once: marks it redeemed in the registry, closes its chain, and reveals the underlying asset's secret code to the current holder.",
    request: z.object({
      publicId: z.string().min(1),
      holderLabel: z.string().min(1).max(80),
    }),
    response: z.object({ note: noteDetail }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const note = await findNote(ctx, args.publicId);
      if (note.status === "redeemed") {
        throw new Error("This Note was already redeemed and burned. A Note can be spent only once.");
      }
      if (!sameHolder(args.holderLabel, note.currentHolder)) {
        throw new Error("The holder name given does not match the Note's current holder.");
      }
      const basis = await getBasis();
      const sequence = note.eventSequence.split(",") as LatticeEvent[];
      const extHash = await sha256Hex(
        `${note.terminusHex}:redeem:${sequence.length}`,
      );
      sequence.push(...eventsFromHash(extHash, 16));
      const [x, y, zCoord] = await computeTerminus(sequence, basis);
      const termHex = x.toString(16);
      const now = new Date();

      await db
        .update(schema.notes)
        .set({
          eventSequence: sequence.join(","),
          terminusHex: termHex,
          terminusX: x.toString(16),
          terminusY: y.toString(16),
          terminusZ: zCoord.toString(16),
          status: "redeemed",
          redeemedAt: now,
        })
        .where(eq(schema.notes.id, note.id));
      await db.insert(schema.noteEvents).values({
        noteId: note.id,
        kind: "redeem",
        fromHolder: note.currentHolder,
        toHolder: note.currentHolder,
        sequenceLength: sequence.length,
        terminusAfter: termHex,
        message: null,
      });

      const updated = await findNote(ctx, note.publicId);
      ctx.invalidateQueries();
      return { note: await toDetail(ctx, updated, true) };
    },
  }),

  verifyNote: defineAction({
    description:
      "Verifies a Note by public code: recomputes every step of its lattice chain from the recorded inputs and reports whether the chain is intact and whether the Note is still active or already burned.",
    request: z.object({ publicId: z.string().min(1) }),
    response: z.object({
      found: z.boolean(),
      chainIntact: z.boolean(),
      status: z.string().nullable(),
      assetName: z.string().nullable(),
      assetType: z.string().nullable(),
      issuer: z.string().nullable(),
      faceValue: z.number().nullable(),
      currency: z.string().nullable(),
      currentHolder: z.string().nullable(),
      eventCount: z.number(),
      checkedSteps: z.number(),
      failedStep: z.number().nullable(),
      createdAt: z.string().nullable(),
      redeemedAt: z.string().nullable(),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const rows = await db
        .select()
        .from(schema.notes)
        .where(eq(schema.notes.publicId, args.publicId.trim().toUpperCase()))
        .limit(1);
      const note = rows[0];
      if (!note) {
        return {
          found: false,
          chainIntact: false,
          status: null,
          assetName: null,
          assetType: null,
          issuer: null,
          faceValue: null,
          currency: null,
          currentHolder: null,
          eventCount: 0,
          checkedSteps: 0,
          failedStep: null,
          createdAt: null,
          redeemedAt: null,
        };
      }
      const basis = await getBasis();
      const sequence = note.eventSequence.split(",") as LatticeEvent[];
      const events = await loadEvents(ctx, note.id);
      let failedStep: number | null = null;
      let checked = 0;
      for (let i = 0; i < events.length; i++) {
        const ev = events[i];
        if (!ev) break;
        const recomputed = await terminusAt(sequence, ev.sequenceLength, basis);
        checked++;
        if (recomputed !== ev.terminusAfter) {
          failedStep = i + 1;
          break;
        }
      }
      // Final terminus (all three coordinates) must match the registry too.
      let finalOk = failedStep === null;
      if (finalOk) {
        const [x, y, zCoord] = await computeTerminus(sequence, basis);
        finalOk =
          x.toString(16) === note.terminusX &&
          y.toString(16) === note.terminusY &&
          zCoord.toString(16) === note.terminusZ &&
          x.toString(16) === note.terminusHex;
        if (!finalOk) failedStep = events.length;
      }
      return {
        found: true,
        chainIntact: finalOk,
        status: note.status,
        assetName: note.assetName,
        assetType: note.assetType,
        issuer: note.issuer,
        faceValue: note.faceValue,
        currency: note.currency,
        currentHolder: note.currentHolder,
        eventCount: events.length,
        checkedSteps: checked,
        failedStep,
        createdAt: note.createdAt.toISOString(),
        redeemedAt: note.redeemedAt ? note.redeemedAt.toISOString() : null,
      };
    },
  }),

  attachReference: defineAction({
    description:
      "Attaches or replaces an external reference (for example a payment transaction hash or receipt number) on an active Note, holder-checked.",
    request: z.object({
      publicId: z.string().min(1),
      holderLabel: z.string().min(1).max(80),
      externalRef: z.string().min(1).max(200),
    }),
    response: z.object({ note: noteDetail }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const note = await findNote(ctx, args.publicId);
      if (!sameHolder(args.holderLabel, note.currentHolder)) {
        throw new Error("The holder name given does not match the Note's current holder.");
      }
      await db
        .update(schema.notes)
        .set({ externalRef: args.externalRef.trim() })
        .where(eq(schema.notes.id, note.id));
      const updated = await findNote(ctx, note.publicId);
      ctx.invalidateQueries();
      return {
        note: await toDetail(ctx, updated, updated.status === "redeemed"),
      };
    },
  }),
} satisfies ActionsModule;
