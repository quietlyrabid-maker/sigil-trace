import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent, type ReactNode } from "react";
import { SafeAreaTopScrim } from "@hatch/space-sdk/client";
import { api, type ApiResponse } from "./api";

type NoteSummary = ApiResponse<typeof api, "listNotes">["notes"][number];
type NoteDetail = ApiResponse<typeof api, "getNote">["note"];
type VerifyResult = ApiResponse<typeof api, "verifyNote">;

const TYPE_LABELS: Record<string, string> = {
  gift_card: "Gift card",
  ticket: "Ticket",
  voucher: "Voucher",
  certificate: "Certificate",
  other: "Other asset",
};

function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

function fmtValue(faceValue: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
    }).format(faceValue);
  } catch {
    return `${currency} ${faceValue.toFixed(2)}`;
  }
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

// The Note's face: a 20x20 matrix driven by the terminus hash.
function Matrix({ bits, small }: { bits: string; small?: boolean }) {
  const cells = bits.padEnd(400, "0").slice(0, 400).split("");
  return (
    <div
      aria-hidden="true"
      className="grid shrink-0"
      style={{
        gridTemplateColumns: "repeat(20, 1fr)",
        gap: small ? 1 : 2,
        width: small ? 76 : "100%",
        maxWidth: small ? 76 : 300,
        aspectRatio: "1",
      }}
    >
      {cells.map((b, i) => (
        <div
          key={i}
          style={{
            background: b === "1" ? "var(--cell-on)" : "var(--cell-off)",
            borderRadius: 1,
          }}
        />
      ))}
    </div>
  );
}

function StatusStamp({ status, short }: { status: string; short?: boolean }) {
  const redeemed = status === "redeemed";
  return (
    <span
      className="font-serial inline-block shrink-0 px-2 py-0.5 text-[11px] font-bold tracking-widest uppercase"
      style={{
        color: redeemed ? "var(--oxblood)" : "var(--verdigris)",
        border: `1.5px solid ${redeemed ? "var(--oxblood)" : "var(--verdigris)"}`,
        borderRadius: 4,
        transform: "rotate(-2deg)",
      }}
    >
      {redeemed ? (short ? "Burned" : "Redeemed · Burned") : "Active"}
    </span>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-[var(--text)]">
        {label}
      </span>
      {children}
    </label>
  );
}

const inputCls =
  "w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-base text-[var(--text)]";

function PrimaryButton({
  children,
  onClick,
  disabled,
  type,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: "submit" | "button";
}) {
  return (
    <button
      type={type ?? "button"}
      onClick={onClick}
      disabled={disabled}
      className="rounded-[var(--radius)] px-4 py-2 text-base font-semibold disabled:opacity-50"
      style={{ background: "var(--accent)", color: "var(--accent-ink)" }}
    >
      {children}
    </button>
  );
}

function GhostButton({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-[var(--radius)] border border-[var(--border)] px-4 py-2 text-base text-[var(--text)] disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p
      role="alert"
      className="rounded-[var(--radius)] px-3 py-2 text-sm"
      style={{
        color: "var(--oxblood)",
        border: "1px solid var(--oxblood)",
      }}
    >
      {errMsg(error)}
    </p>
  );
}

// ---------------- Vault list ----------------

function VaultList({ onOpen }: { onOpen: (publicId: string) => void }) {
  const notes = useQuery({
    queryKey: ["notes"],
    queryFn: () => api.listNotes({ limit: 50 }),
  });
  if (notes.isPending) return <p className="py-8 text-[var(--dim)]">Opening the vault…</p>;
  if (notes.error) return <ErrorBox error={notes.error} />;
  const list = notes.data.notes;
  if (list.length === 0) {
    return (
      <div className="py-10 text-center">
        <p className="font-plate text-xl text-[var(--text)]">The vault is empty.</p>
        <p className="mx-auto mt-2 max-w-sm text-sm text-[var(--dim)]">
          Wrap your first asset — a gift card, a ticket, a voucher — and it
          becomes a Note here: one holder, one chain of proof, spendable
          exactly once.
        </p>
      </div>
    );
  }
  return (
    <ul className="flex flex-col gap-3">
      {list.map((n) => (
        <li key={n.id}>
          <button
            type="button"
            onClick={() => onOpen(n.publicId)}
            aria-label={`Open note ${n.publicId} for ${n.assetName}`}
            className="flex w-full items-center gap-4 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-3 text-left"
          >
            <Matrix bits={n.bits} small />
            <span className="min-w-0 flex-1">
              <span className="font-plate block truncate text-lg text-[var(--text)]">
                {n.assetName}
              </span>
              <span className="block text-sm text-[var(--dim)]">
                {TYPE_LABELS[n.assetType] ?? n.assetType}
                {n.issuer ? ` · ${n.issuer}` : ""} ·{" "}
                {fmtValue(n.faceValue, n.currency)}
              </span>
              <span className="font-serial block truncate text-xs text-[var(--dim)]">
                {n.publicId} · held by {n.currentHolder}
              </span>
            </span>
            <StatusStamp status={n.status} short />
          </button>
        </li>
      ))}
    </ul>
  );
}

// ---------------- Mint ----------------

function MintForm({ onMinted }: { onMinted: (publicId: string) => void }) {
  const queryClient = useQueryClient();
  const [assetType, setAssetType] = useState("gift_card");
  const [assetName, setAssetName] = useState("");
  const [assetRef, setAssetRef] = useState("");
  const [issuer, setIssuer] = useState("");
  const [faceValue, setFaceValue] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [secretCode, setSecretCode] = useState("");
  const [ownerLabel, setOwnerLabel] = useState("");
  const [externalRef, setExternalRef] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const mint = useMutation({
    mutationFn: async () =>
      await api.mintNote({
        assetType: assetType as
          | "gift_card"
          | "ticket"
          | "voucher"
          | "certificate"
          | "other",
        assetName: assetName.trim(),
        assetRef: assetRef.trim(),
        issuer: issuer.trim() || undefined,
        faceValue: Number(faceValue),
        currency: currency.trim().toUpperCase() || "USD",
        secretCode: secretCode.trim(),
        ownerLabel: ownerLabel.trim(),
        externalRef: externalRef.trim() || undefined,
      }),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: ["notes"] });
      onMinted(res.note.publicId);
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setLocalError(null);
    if (!assetName.trim()) return setLocalError("Give the asset a name.");
    if (!assetRef.trim())
      return setLocalError("Enter the asset ID or serial — this is what the Note is derived from.");
    if (!secretCode.trim())
      return setLocalError("Enter the asset's secret code. It stays hidden until the Note is redeemed.");
    if (!ownerLabel.trim())
      return setLocalError("Enter your holder name. The terminus is salted with it, and transfers and redemption check it.");
    const value = Number(faceValue);
    if (faceValue.trim() === "" || Number.isNaN(value) || value < 0)
      return setLocalError("Enter the face value as a number (0 or more).");
    mint.mutate();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Field label="Asset type">
        <select
          aria-label="Asset type"
          className={inputCls}
          value={assetType}
          onChange={(e) => setAssetType(e.target.value)}
        >
          <option value="gift_card">Gift card</option>
          <option value="ticket">Ticket</option>
          <option value="voucher">Voucher</option>
          <option value="certificate">Certificate</option>
          <option value="other">Other asset</option>
        </select>
      </Field>
      <Field label="Asset name">
        <input
          aria-label="Asset name"
          className={inputCls}
          value={assetName}
          onChange={(e) => setAssetName(e.target.value)}
          placeholder="Coffee gift card"
        />
      </Field>
      <Field label="Asset ID / serial">
        <input
          aria-label="Asset ID or serial"
          className={inputCls}
          value={assetRef}
          onChange={(e) => setAssetRef(e.target.value)}
          placeholder="e.g. COFFEE-GIFT-25-USD"
        />
      </Field>
      <Field label="Issuer (optional)">
        <input
          aria-label="Issuer"
          className={inputCls}
          value={issuer}
          onChange={(e) => setIssuer(e.target.value)}
          placeholder="Who issued it"
        />
      </Field>
      <div className="flex gap-3">
        <div className="flex-1">
          <Field label="Face value">
            <input
              aria-label="Face value"
              className={inputCls}
              inputMode="decimal"
              value={faceValue}
              onChange={(e) => setFaceValue(e.target.value)}
              placeholder="25"
            />
          </Field>
        </div>
        <div className="w-24">
          <Field label="Currency">
            <input
              aria-label="Currency"
              className={inputCls}
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              maxLength={8}
            />
          </Field>
        </div>
      </div>
      <Field label="Secret code (card number, ticket code…)">
        <input
          aria-label="Secret code"
          className={inputCls}
          value={secretCode}
          onChange={(e) => setSecretCode(e.target.value)}
          placeholder="The code itself — hidden until redemption"
          autoComplete="off"
        />
      </Field>
      <Field label="Your holder name">
        <input
          aria-label="Your holder name"
          className={inputCls}
          value={ownerLabel}
          onChange={(e) => setOwnerLabel(e.target.value)}
          placeholder="Who holds this Note first"
        />
      </Field>
      <Field label="External reference (optional)">
        <input
          aria-label="External reference"
          className={inputCls}
          value={externalRef}
          onChange={(e) => setExternalRef(e.target.value)}
          placeholder="A payment tx hash, receipt number…"
        />
      </Field>
      {localError ? (
        <p role="alert" className="text-sm" style={{ color: "var(--oxblood)" }}>
          {localError}
        </p>
      ) : null}
      <ErrorBox error={mint.error} />
      <PrimaryButton type="submit" disabled={mint.isPending}>
        {mint.isPending ? "Minting…" : "Mint the Note"}
      </PrimaryButton>
      <p className="text-sm text-[var(--dim)]">
        Minting salts the terminus with your holder name and a one-time
        nonce, so the same asset wrapped twice — or by two different
        people — never produces the same Note.
      </p>
    </form>
  );
}

// ---------------- Note detail ----------------

function TransferForm({ note }: { note: NoteDetail }) {
  const queryClient = useQueryClient();
  const [fromHolder, setFromHolder] = useState(note.currentHolder);
  const [toHolder, setToHolder] = useState("");
  const [message, setMessage] = useState("");
  const transfer = useMutation({
    mutationFn: async () =>
      await api.transferNote({
        publicId: note.publicId,
        fromHolder: fromHolder.trim(),
        toHolder: toHolder.trim(),
        message: message.trim() || undefined,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["notes"] });
      void queryClient.invalidateQueries({ queryKey: ["note", note.publicId] });
      setToHolder("");
      setMessage("");
    },
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    if (fromHolder.trim() && toHolder.trim()) transfer.mutate();
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <Field label="Current holder (must match)">
        <input
          aria-label="Current holder for transfer"
          className={inputCls}
          value={fromHolder}
          onChange={(e) => setFromHolder(e.target.value)}
        />
      </Field>
      <Field label="New holder">
        <input
          aria-label="New holder"
          className={inputCls}
          value={toHolder}
          onChange={(e) => setToHolder(e.target.value)}
          placeholder="Who receives the Note"
        />
      </Field>
      <Field label="Message (optional)">
        <input
          aria-label="Transfer message"
          className={inputCls}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="For the gig on Friday…"
        />
      </Field>
      <ErrorBox error={transfer.error} />
      <PrimaryButton type="submit" disabled={transfer.isPending || !toHolder.trim()}>
        {transfer.isPending ? "Transferring…" : "Transfer the Note"}
      </PrimaryButton>
    </form>
  );
}

function RedeemPanel({ note }: { note: NoteDetail }) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [holderLabel, setHolderLabel] = useState(note.currentHolder);
  const redeem = useMutation({
    mutationFn: async () =>
      await api.redeemNote({ publicId: note.publicId, holderLabel: holderLabel.trim() }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["notes"] });
      void queryClient.invalidateQueries({ queryKey: ["note", note.publicId] });
    },
  });
  if (!confirming) {
    return (
      <div>
        <PrimaryButton onClick={() => setConfirming(true)}>
          Redeem &amp; burn this Note
        </PrimaryButton>
        <p className="mt-2 text-sm text-[var(--dim)]">
          Redeeming reveals the secret code and burns the Note. It can
          never be transferred or spent again.
        </p>
      </div>
    );
  }
  return (
    <div
      className="flex flex-col gap-3 rounded-[var(--radius)] p-3"
      style={{ border: "1.5px solid var(--oxblood)" }}
    >
      <p className="font-plate text-lg text-[var(--text)]">Burn it, for good?</p>
      <p className="text-sm text-[var(--dim)]">
        This is the one spend this Note gets. The code is revealed and the
        chain is closed — there is no undo.
      </p>
      <Field label="Current holder (must match)">
        <input
          aria-label="Current holder for redemption"
          className={inputCls}
          value={holderLabel}
          onChange={(e) => setHolderLabel(e.target.value)}
        />
      </Field>
      <ErrorBox error={redeem.error} />
      <div className="flex gap-2">
        <PrimaryButton onClick={() => redeem.mutate()} disabled={redeem.isPending || !holderLabel.trim()}>
          {redeem.isPending ? "Burning…" : "Yes — redeem & burn"}
        </PrimaryButton>
        <GhostButton onClick={() => setConfirming(false)}>Not yet</GhostButton>
      </div>
    </div>
  );
}

function ReferenceForm({ note }: { note: NoteDetail }) {
  const queryClient = useQueryClient();
  const [ref, setRef] = useState(note.externalRef ?? "");
  const [holderLabel, setHolderLabel] = useState(note.currentHolder);
  const attach = useMutation({
    mutationFn: async () =>
      await api.attachReference({
        publicId: note.publicId,
        holderLabel: holderLabel.trim(),
        externalRef: ref.trim(),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["note", note.publicId] });
    },
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    if (ref.trim() && holderLabel.trim()) attach.mutate();
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <Field label="External reference">
        <input
          aria-label="External reference"
          className={inputCls}
          value={ref}
          onChange={(e) => setRef(e.target.value)}
          placeholder="Payment tx hash, receipt number…"
        />
      </Field>
      <Field label="Current holder (must match)">
        <input
          aria-label="Current holder for reference"
          className={inputCls}
          value={holderLabel}
          onChange={(e) => setHolderLabel(e.target.value)}
        />
      </Field>
      <ErrorBox error={attach.error} />
      <PrimaryButton type="submit" disabled={attach.isPending || !ref.trim()}>
        {attach.isPending ? "Saving…" : "Save reference"}
      </PrimaryButton>
    </form>
  );
}

function SecretReveal({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }
  return (
    <div
      className="rounded-[var(--radius)] p-4"
      style={{ border: "1.5px solid var(--oxblood)", background: "var(--surface)" }}
    >
      <p className="text-sm font-medium text-[var(--text)]">
        The secret code — revealed at redemption
      </p>
      <p className="font-serial mt-2 text-lg break-all text-[var(--text)]">{code}</p>
      <div className="mt-3">
        <GhostButton onClick={copy}>{copied ? "Copied" : "Copy the code"}</GhostButton>
      </div>
    </div>
  );
}

function NoteDetailView({ publicId }: { publicId: string }) {
  const detail = useQuery({
    queryKey: ["note", publicId],
    queryFn: () => api.getNote({ publicId }),
  });
  if (detail.isPending) return <p className="py-8 text-[var(--dim)]">Loading the Note…</p>;
  if (detail.error) return <ErrorBox error={detail.error} />;
  const note = detail.data.note;
  const active = note.status === "active";
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col items-center gap-3">
        <div className="relative">
          <Matrix bits={note.bits} />
          {active ? null : (
            <span
              className="font-serial absolute inset-0 flex items-center justify-center text-center text-sm font-bold tracking-widest uppercase"
              style={{ color: "var(--oxblood)", transform: "rotate(-8deg)" }}
            >
              Redeemed
            </span>
          )}
        </div>
        <p className="font-serial text-sm text-[var(--dim)]">{note.publicId}</p>
        <StatusStamp status={note.status} />
      </div>

      <div>
        <h2 className="font-plate text-2xl text-[var(--text)]">{note.assetName}</h2>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-[var(--dim)]">Type</dt>
          <dd className="text-[var(--text)]">{TYPE_LABELS[note.assetType] ?? note.assetType}</dd>
          {note.issuer ? (
            <>
              <dt className="text-[var(--dim)]">Issuer</dt>
              <dd className="text-[var(--text)]">{note.issuer}</dd>
            </>
          ) : null}
          <dt className="text-[var(--dim)]">Face value</dt>
          <dd className="text-[var(--text)]">{fmtValue(note.faceValue, note.currency)}</dd>
          <dt className="text-[var(--dim)]">Asset ID</dt>
          <dd className="font-serial text-[var(--text)]">{note.assetRef}</dd>
          <dt className="text-[var(--dim)]">Holder</dt>
          <dd className="text-[var(--text)]">{note.currentHolder}</dd>
          <dt className="text-[var(--dim)]">Minted</dt>
          <dd className="text-[var(--text)]">{fmtDate(note.createdAt)}</dd>
          {note.redeemedAt ? (
            <>
              <dt className="text-[var(--dim)]">Redeemed</dt>
              <dd className="text-[var(--text)]">{fmtDate(note.redeemedAt)}</dd>
            </>
          ) : null}
          {note.externalRef ? (
            <>
              <dt className="text-[var(--dim)]">Reference</dt>
              <dd className="font-serial break-all text-[var(--text)]">{note.externalRef}</dd>
            </>
          ) : null}
          <dt className="text-[var(--dim)]">Terminus</dt>
          <dd className="font-serial break-all text-[var(--text)]">0x{note.terminusHex}…</dd>
        </dl>
      </div>

      {note.secretCode ? <SecretReveal code={note.secretCode} /> : null}

      <div>
        <h3 className="font-plate text-lg text-[var(--text)]">Chain of proof</h3>
        <ol className="mt-2 flex flex-col gap-2">
          {note.events.map((ev) => (
            <li
              key={ev.id}
              className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
            >
              <p className="text-sm text-[var(--text)]">
                <span className="font-semibold capitalize">{ev.kind}</span>
                {ev.kind === "mint" ? (
                  <> — wrapped by {ev.toHolder}</>
                ) : ev.kind === "transfer" ? (
                  <> — {ev.fromHolder} → {ev.toHolder}</>
                ) : (
                  <> — spent by {ev.toHolder}, Note burned</>
                )}
              </p>
              {ev.message ? <p className="text-sm text-[var(--dim)]">“{ev.message}”</p> : null}
              <p className="font-serial mt-1 text-xs break-all text-[var(--dim)]">
                terminus 0x{ev.terminusAfter.slice(0, 16)}… · {fmtDate(ev.createdAt)}
              </p>
            </li>
          ))}
        </ol>
      </div>

      {active ? (
        <>
          <div>
            <h3 className="font-plate mb-2 text-lg text-[var(--text)]">Hand it on</h3>
            <TransferForm key={`t-${note.eventCount}`} note={note} />
          </div>
          <div>
            <h3 className="font-plate mb-2 text-lg text-[var(--text)]">Spend it</h3>
            <RedeemPanel note={note} />
          </div>
          <div>
            <h3 className="font-plate mb-2 text-lg text-[var(--text)]">Anchor it elsewhere</h3>
            <p className="mb-2 text-sm text-[var(--dim)]">
              Paid for this Note somewhere else — a wallet payment, a
              marketplace sale? Record that reference on the Note.
            </p>
            <ReferenceForm note={note} />
          </div>
        </>
      ) : null}
    </div>
  );
}

// ---------------- Verify ----------------

function VerifyView() {
  const [code, setCode] = useState("");
  const [result, setResult] = useState<VerifyResult | null>(null);
  const verify = useMutation({
    mutationFn: async () => await api.verifyNote({ publicId: code.trim() }),
    onSuccess: (res) => setResult(res),
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    if (code.trim()) verify.mutate();
  }
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-[var(--dim)]">
        Someone handed you a Note? Enter its code. Verification recomputes
        every step of its lattice chain from the recorded inputs — if any
        recorded detail had been altered, the chain would not recompute —
        and tells you whether the Note is still spendable or already burned.
      </p>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <Field label="Note code">
          <input
            aria-label="Note code to verify"
            className={`${inputCls} font-serial`}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="SIGIL-XXXXXXXX"
            autoComplete="off"
          />
        </Field>
        <ErrorBox error={verify.error} />
        <PrimaryButton type="submit" disabled={verify.isPending || !code.trim()}>
          {verify.isPending ? "Recomputing the chain…" : "Verify this Note"}
        </PrimaryButton>
      </form>
      {result ? (
        result.found ? (
          <div
            className="rounded-[var(--radius)] p-4"
            style={{
              border: `1.5px solid ${result.chainIntact ? "var(--verdigris)" : "var(--oxblood)"}`,
              background: "var(--surface)",
            }}
          >
            <p className="font-plate text-xl text-[var(--text)]">
              {result.chainIntact
                ? "Chain intact — this Note is genuine as recorded."
                : "Chain broken — the recorded details do not recompute."}
            </p>
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-[var(--dim)]">Asset</dt>
              <dd className="text-[var(--text)]">
                {result.assetName} ({TYPE_LABELS[result.assetType ?? ""] ?? result.assetType})
              </dd>
              <dt className="text-[var(--dim)]">Value</dt>
              <dd className="text-[var(--text)]">
                {result.faceValue != null && result.currency
                  ? fmtValue(result.faceValue, result.currency)
                  : "—"}
              </dd>
              <dt className="text-[var(--dim)]">Holder</dt>
              <dd className="text-[var(--text)]">{result.currentHolder}</dd>
              <dt className="text-[var(--dim)]">Status</dt>
              <dd className="text-[var(--text)]">
                {result.status === "redeemed"
                  ? "Redeemed and burned — it cannot be spent again."
                  : "Active — not yet spent."}
              </dd>
              <dt className="text-[var(--dim)]">Chain steps checked</dt>
              <dd className="text-[var(--text)]">
                {result.checkedSteps} of {result.eventCount}
                {result.failedStep != null ? ` — failed at step ${result.failedStep}` : ""}
              </dd>
            </dl>
            <p className="mt-3 text-sm text-[var(--dim)]">
              Verification proves the record has not been altered and shows
              whether the Note was already spent. It cannot prove the
              underlying card or ticket is still funded — that remains the
              issuer's word.
            </p>
          </div>
        ) : (
          <p role="alert" className="text-sm" style={{ color: "var(--oxblood)" }}>
            No Note with that code exists in this registry.
          </p>
        )
      ) : null}
    </div>
  );
}

// ---------------- App shell ----------------

type View =
  | { kind: "vault" }
  | { kind: "mint" }
  | { kind: "verify" }
  | { kind: "detail"; publicId: string };

export function App() {
  const [view, setView] = useState<View>({ kind: "vault" });

  const tabCls = (active: boolean) =>
    `flex-1 rounded-[var(--radius)] px-3 py-2 text-base font-medium ${
      active ? "" : "text-[var(--dim)]"
    }`;

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <SafeAreaTopScrim backgroundColor="var(--bg)" />
      <main className="mx-auto w-full max-w-2xl px-4 pb-10">
        <p className="font-plate pt-6 text-3xl leading-tight text-[var(--text)]">
          Wrap any asset. Hold the Note. Spend it once.
        </p>
        <p className="mt-2 text-sm text-[var(--dim)]">
          A gift card, a ticket, a voucher — wrapped into a Note whose
          lattice terminus is salted to its holder, whose every handover is
          recorded in a recomputable chain, and which burns the moment it
          is redeemed.
        </p>

        <nav aria-label="Sections" className="mt-5 flex gap-1 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-1">
          <button
            type="button"
            className={tabCls(view.kind === "vault" || view.kind === "detail")}
            style={
              view.kind === "vault" || view.kind === "detail"
                ? { background: "var(--surface-alt)", color: "var(--text)" }
                : undefined
            }
            onClick={() => setView({ kind: "vault" })}
          >
            Vault
          </button>
          <button
            type="button"
            className={tabCls(view.kind === "mint")}
            style={
              view.kind === "mint"
                ? { background: "var(--surface-alt)", color: "var(--text)" }
                : undefined
            }
            onClick={() => setView({ kind: "mint" })}
          >
            Mint
          </button>
          <button
            type="button"
            className={tabCls(view.kind === "verify")}
            style={
              view.kind === "verify"
                ? { background: "var(--surface-alt)", color: "var(--text)" }
                : undefined
            }
            onClick={() => setView({ kind: "verify" })}
          >
            Verify
          </button>
        </nav>

        <div className="mt-6">
          {view.kind === "vault" ? (
            <>
              <VaultList onOpen={(publicId) => setView({ kind: "detail", publicId })} />
              <section className="mt-10 border-t border-[var(--border)] pt-5">
                <h2 className="font-plate text-lg text-[var(--text)]">What a Note proves — and what it doesn’t</h2>
                <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-sm text-[var(--dim)]">
                  <li>It proves the recorded asset details have not been altered since minting: the terminus recomputes from them, step by step.</li>
                  <li>It proves whether the Note has already been spent. A redeemed Note is burned in the registry and cannot be transferred or spent again.</li>
                  <li>Its terminus is bound to its holder and a one-time nonce, so two Notes wrapping the same asset are never the same Note.</li>
                  <li>The secret code stays hidden from everyone — including anyone verifying the Note — until the holder redeems it.</li>
                  <li>It does not prove the underlying card or ticket is genuine or still funded. That is still the issuer’s word; the Note proves the wrapping, the holder, and the single spend.</li>
                </ul>
              </section>
            </>
          ) : view.kind === "mint" ? (
            <MintForm onMinted={(publicId) => setView({ kind: "detail", publicId })} />
          ) : view.kind === "verify" ? (
            <VerifyView />
          ) : (
            <div>
              <div className="mb-4">
                <GhostButton onClick={() => setView({ kind: "vault" })}>← Back to the vault</GhostButton>
              </div>
              <NoteDetailView publicId={view.publicId} />
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
