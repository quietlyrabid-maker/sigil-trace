CREATE TABLE notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  asset_ref TEXT NOT NULL,
  asset_type TEXT NOT NULL,
  asset_name TEXT NOT NULL,
  issuer TEXT,
  face_value REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  secret_code TEXT NOT NULL,
  owner_salt TEXT NOT NULL,
  nonce TEXT NOT NULL,
  event_sequence TEXT NOT NULL,
  terminus_hex TEXT NOT NULL,
  terminus_x TEXT NOT NULL,
  terminus_y TEXT NOT NULL,
  terminus_z TEXT NOT NULL,
  current_holder TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  external_ref TEXT,
  created_at INTEGER NOT NULL,
  redeemed_at INTEGER
);
--> statement-breakpoint
CREATE TABLE note_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  note_id INTEGER NOT NULL REFERENCES notes(id),
  kind TEXT NOT NULL,
  from_holder TEXT,
  to_holder TEXT NOT NULL,
  sequence_length INTEGER NOT NULL,
  terminus_after TEXT NOT NULL,
  message TEXT,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
DROP TABLE entries;
