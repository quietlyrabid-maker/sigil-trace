# Sigil Trace — fixed version

**Wrap any asset. Own the proof. Mint a Note — and prove it hasn't been spent twice.**

This is the fixed, working version of Sigil Trace. It replaces the original
Nimiq Mini Apps Competition (Cycle 3) demo that used to live in this repo.
That demo is gone — see "What changed" below.

## What it does

- **Mint any asset** — gift card, ticket, voucher, certificate, or other —
  into a Note, with your own secret code.
- **Verify before accepting** — `verifyNote` recomputes the whole lattice
  chain and reports whether it is intact and still spendable.
- **Transfer** — moving a Note to a new holder appends to the chain, with
  full history.
- **Redeem once, then it burns** — redeeming reveals the secret code exactly
  once and marks the Note redeemed. A second redeem is rejected.
- **Code hidden until redemption** — the secret code is null in mint, list,
  and detail responses while a Note is active.

## What changed from the original demo

The original demo had two hardcoded assets, a terminus that was
deterministic from the asset ID alone, no verify function, and no burn.

The fixed version:

- The terminus is salted with the holder name and a one-time random nonce,
  so the same asset wrapped twice, or by two holders, produces different
  termini and different public codes.
- Every lifecycle step (mint, transfer, redeem) appends real events to the
  sequence and recomputes the terminus. Each step is stored, so verification
  recomputes the whole chain.
- Redeem burns the Note exactly once. No further transfer or redeem is
  accepted after that.
- Overclaims were removed. This does **not** claim zero-knowledge, and it
  does **not** claim replay-proofing beyond the single-spend registry in
  this app.

## What it does NOT do

- **No live Nimiq payment.** The original demo sent a Nimiq payment to a
  hardcoded recipient. This version takes no payment.
- **No real merchant redemption.** Redemption happens inside the app only.
  No merchant accepts a Note yet, and the app does not prove that the
  underlying gift card or ticket is still funded — only that this Note's
  record is unaltered, it has not been spent here before, and its code was
  hidden until redemption.
- **No revenue, no users.** This is a working pre-revenue app, not a
  business with customers.

## How the proof works

The engine is the original Sigil Trace lattice, ported faithfully:
a 3D accumulator over the secp256k1 prime Q, with one SHA-256 basis vector
per event kind (`init` / `auth` / `transfer`), and a terminus rendered as a
20×20 matrix from 4× SHA-256 of the terminus hex.

What a Note proves: the record is unaltered, it is a single spend, and the
code was hidden until redemption. What it does not prove: that the
underlying card is still funded.

## Code layout

- `client/src/App.tsx` — the app: mint, vault, detail, verify, transfer,
  redeem, contacts/history views.
- `client/src/api.ts` — typed calls to the server actions.
- `server/src/actions.ts` — mint, list, inspect, transfer, redeem (burn),
  verify, and external references. This is where the lattice engine,
  the salted terminus, and the single-spend check live.
- `server/src/schema.ts` — notes and note-events tables.
- `drizzle/` — database migrations for those tables.
- `space.json` — identifies this as the Sigil Trace app.

## Running it

This code was built and verified as a hosted app in the environment it was
developed in, where the server actions and database are provided by that
runtime. `package.json` still references that runtime (`@hatch/space-sdk`),
so it is **not** a standalone `npm install` / `npm run dev` project as
published — running it elsewhere would need that runtime, or a replacement
for the action/database layer, wired up first.

## Built by David James Swindle

Built on a borrowed laptop and a Galaxy phone.
