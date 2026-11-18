// Drizzle schema for Sigil Trace: the Note registry.
//
// A Note wraps one user-entered asset. Its terminus is computed by the
// 3D lattice engine (see actions.ts) over an event sequence derived from
// the asset ref, an owner salt, and a one-time nonce — so the same asset
// wrapped twice, or by two different holders, produces different Notes.
// note_events is the append-only lifecycle chain: mint, each transfer,
// and the final redeem (burn). Each event records the terminus after its
// step so the whole chain can be recomputed and checked.

import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const notes = sqliteTable("notes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  publicId: text("public_id").notNull().unique(),
  assetRef: text("asset_ref").notNull(),
  assetType: text("asset_type", {
    enum: ["gift_card", "ticket", "voucher", "certificate", "other"],
  }).notNull(),
  assetName: text("asset_name").notNull(),
  issuer: text("issuer"),
  faceValue: real("face_value").notNull(),
  currency: text("currency").notNull().default("USD"),
  // The underlying asset code. Stored server-side, never returned by
  // list/get/verify; revealed only by the redeem action, once, at burn.
  secretCode: text("secret_code").notNull(),
  ownerSalt: text("owner_salt").notNull(),
  nonce: text("nonce").notNull(),
  eventSequence: text("event_sequence").notNull(),
  terminusHex: text("terminus_hex").notNull(),
  terminusX: text("terminus_x").notNull(),
  terminusY: text("terminus_y").notNull(),
  terminusZ: text("terminus_z").notNull(),
  currentHolder: text("current_holder").notNull(),
  status: text("status", { enum: ["active", "redeemed"] })
    .notNull()
    .default("active"),
  externalRef: text("external_ref"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  redeemedAt: integer("redeemed_at", { mode: "timestamp_ms" }),
});

export const noteEvents = sqliteTable("note_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  noteId: integer("note_id")
    .notNull()
    .references(() => notes.id),
  kind: text("kind", { enum: ["mint", "transfer", "redeem"] }).notNull(),
  fromHolder: text("from_holder"),
  toHolder: text("to_holder").notNull(),
  sequenceLength: integer("sequence_length").notNull(),
  terminusAfter: text("terminus_after").notNull(),
  message: text("message"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});
