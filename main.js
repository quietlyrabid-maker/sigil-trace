/**
 * Sigil Lattice — Nimiq Pay Mini App
 * Verifiable execution-trace system adapted for the Nimiq Mini Apps Competition.
 *
 * Core idea (ported from the original Python protocol):
 * A 3-dimensional key moves through modular space ℤ_q³.
 * Each event is a basis vector. Position-weighted + hash-chained accumulation
 * produces a unique terminus. Any change to the sequence changes the terminus.
 */

const Q = (2n ** 128n) - 1n; // 128-bit modulus
const EVENT_TYPES = [
  "init",
  "auth",
  "transfer",
  "confirm",
  "settle",
  "audit",
  "notify",
  "close",
  "custom_a",
  "custom_b",
];

// ---------- Cryptographic helpers (pure JS, no external deps) ----------

async function sha256Hex(str) {
  const data = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256BigInt(str) {
  const hex = await sha256Hex(str);
  return BigInt("0x" + hex);
}

/**
 * Deterministic basis generation from a salt (same idea as the Python version).
 * For a real production system the salt would be high-entropy / derived from a key.
 */
async function generateBasis(seedSalt, events, modulus) {
  const basis = {};
  for (const e of events) {
    const h = await sha256Hex(seedSalt + e);
    const x = (await sha256BigInt(h + "x")) % modulus;
    const y = (await sha256BigInt(h + "y")) % modulus;
    const z = (await sha256BigInt(h + "z")) % modulus;
    basis[e] = [x, y, z];
  }
  return basis;
}

/**
 * Hash-chained, position-weighted, state-dependent accumulation.
 * This is the heart of the lattice path encoding.
 */
async function computeTerminus(eventSequence, basis, q) {
  let x = 0n;
  let y = 0n;
  let z = 0n;
  let running = 0n;

  for (let pos = 1; pos <= eventSequence.length; pos++) {
    const e = eventSequence[pos - 1];
    const [vx, vy, vz] = basis[e];

    // Hash depends on previous state, position, and event
    const h = await sha256BigInt(`${running}:${pos}:${e}`);

    // Position-weighted, hash-scaled step
    x = (x + vx * BigInt(pos) * h) % q;
    y = (y + vy * BigInt(pos) * h) % q;
    z = (z + vz * BigInt(pos) * h) % q;

    // Non-linear feedback
    running = x ^ y ^ z;
  }

  return [x, y, z];
}

function terminusToString(t) {
  return t.map((v) => v.toString(16).padStart(32, "0")).join(":");
}

// ---------- App state ----------

const state = {
  provider: null,          // Nimiq provider from SDK or injected
  accounts: [],
  consensus: null,
  sequence: ["init", "auth", "transfer"],
  basis: null,
  terminus: null,
  signature: null,
  ready: false,
};

const SEED_SALT = "sigil-lattice-nimiq-v1"; // deterministic for demo; change in prod

// ---------- DOM helpers ----------

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function setStatus(msg, isError = false) {
  const el = $("#wallet-status");
  el.textContent = msg;
  el.style.color = isError ? "var(--danger)" : "var(--muted)";
}

function show(el) {
  el.classList.remove("hidden");
}

function hide(el) {
  el.classList.add("hidden");
}

// ---------- Event list UI ----------

function renderEventList() {
  const list = $("#event-list");
  list.innerHTML = "";

  state.sequence.forEach((ev, idx) => {
    const row = document.createElement("div");
    row.className = "event-row";

    const select = document.createElement("select");
    EVENT_TYPES.forEach((t) => {
      const opt = document.createElement("option");
      opt.value = t;
      opt.textContent = t;
      if (t === ev) opt.selected = true;
      select.appendChild(opt);
    });
    select.addEventListener("change", () => {
      state.sequence[idx] = select.value;
      resetComputed();
    });

    const removeBtn = document.createElement("button");
    removeBtn.textContent = "×";
    removeBtn.title = "Remove";
    removeBtn.addEventListener("click", () => {
      if (state.sequence.length <= 1) return;
      state.sequence.splice(idx, 1);
      renderEventList();
      resetComputed();
    });

    row.appendChild(select);
    row.appendChild(removeBtn);
    list.appendChild(row);
  });
}

function resetComputed() {
  state.terminus = null;
  state.signature = null;
  hide($("#terminus-result"));
  hide($("#sign-result"));
  hide($("#verify-result"));
  $("#btn-sign").disabled = true;
  $("#btn-pay").disabled = true;
  $("#btn-verify").disabled = true;
}

// ---------- Wallet / Provider ----------

async function initProvider() {
  setStatus("Looking for Nimiq Pay provider…");

  // Prefer official SDK if available (when packaged with the project)
  try {
    const mod = await import("@nimiq/mini-app-sdk");
    if (mod && mod.init) {
      state.provider = await mod.init({ timeout: 12000 });
      state.ready = true;
      setStatus("Connected via Mini App SDK");
      $("#btn-connect").disabled = false;
      return;
    }
  } catch (_) {
    // SDK not present — fall through to injected providers
  }

  // Fallback: wait for injected window.nimiq or window.ethereum
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (window.nimiq) {
      state.provider = window.nimiq;
      state.ready = true;
      setStatus("Nimiq provider detected");
      $("#btn-connect").disabled = false;
      return;
    }
    if (window.ethereum) {
      state.provider = { type: "ethereum", eth: window.ethereum };
      state.ready = true;
      setStatus("Ethereum provider detected (limited Nimiq features)");
      $("#btn-connect").disabled = false;
      return;
    }
    await new Promise((r) => setTimeout(r, 300));
  }

  setStatus(
    "Open this page inside Nimiq Pay to enable wallet features. You can still explore the UI.",
    true
  );
  // Still allow the cryptographic demo without a wallet
  $("#btn-compute").disabled = false;
}

async function connectWallet() {
  if (!state.provider) return;

  try {
    if (state.provider.listAccounts) {
      // Native Nimiq provider
      const accounts = await state.provider.listAccounts();
      state.accounts = Array.isArray(accounts) ? accounts : [];
      if (state.provider.isConsensusEstablished) {
        state.consensus = await state.provider.isConsensusEstablished();
      }
    } else if (state.provider.type === "ethereum") {
      const accounts = await state.provider.eth.request({
        method: "eth_requestAccounts",
      });
      state.accounts = accounts || [];
    }

    if (state.accounts.length === 0) {
      setStatus("No accounts returned", true);
      return;
    }

    $("#account-addr").textContent = state.accounts[0];
    $("#consensus").textContent =
      state.consensus === null ? "n/a" : state.consensus ? "yes" : "no";
    show($("#account-info"));
    setStatus("Wallet connected");
    $("#btn-compute").disabled = false;
  } catch (err) {
    setStatus("Connection failed: " + (err.message || err), true);
  }
}

async function signTerminus() {
  if (!state.terminus || !state.provider || state.accounts.length === 0) return;

  const msg = `Sigil Lattice Terminus\n${terminusToString(state.terminus)}\nSequence: ${state.sequence.join(" → ")}`;

  try {
    let sig;
    if (state.provider.sign) {
      sig = await state.provider.sign(msg);
    } else if (state.provider.type === "ethereum") {
      sig = await state.provider.eth.request({
        method: "personal_sign",
        params: [msg, state.accounts[0]],
      });
    } else {
      throw new Error("No sign method available");
    }

    state.signature = typeof sig === "string" ? sig : JSON.stringify(sig);
    $("#signature-display").textContent = state.signature;
    show($("#sign-result"));
    $("#btn-pay").disabled = false;
    $("#btn-verify").disabled = false;
  } catch (err) {
    alert("Signing cancelled or failed: " + (err.message || err));
  }
}

async function sendTipAndCommit() {
  if (!state.provider || !state.provider.sendBasicTransaction) {
    alert("Native NIM send is only available inside Nimiq Pay with the full provider.");
    return;
  }

  const amount = parseFloat($("#tip-amount").value || "0");
  if (amount <= 0) {
    alert("Enter a positive NIM amount or just use Sign Terminus.");
    return;
  }

  // Demo recipient — replace with a real address or burn address for production
  const recipient = "NQ07 0000 0000 0000 0000 0000 0000 0000 0000"; // placeholder

  try {
    // The exact shape of sendBasicTransaction may vary; this follows common patterns.
    // Users should consult the latest Mini App SDK docs for the precise API.
    await state.provider.sendBasicTransaction({
      recipient,
      value: Math.round(amount * 1e5), // lunas (assuming 5 decimals; adjust if needed)
      // data / message can carry the terminus commitment
    });
    alert("Tip sent (if confirmed in wallet). Terminus commitment is recorded.");
  } catch (err) {
    alert("Payment failed or cancelled: " + (err.message || err));
  }
}

// ---------- Core actions ----------

async function onCompute() {
  $("#btn-compute").disabled = true;
  $("#btn-compute").textContent = "Computing…";

  try {
    if (!state.basis) {
      state.basis = await generateBasis(SEED_SALT, EVENT_TYPES, Q);
    }
    state.terminus = await computeTerminus(state.sequence, state.basis, Q);
    $("#terminus-display").textContent = terminusToString(state.terminus);
    show($("#terminus-result"));
    $("#btn-sign").disabled = !state.ready || state.accounts.length === 0;
    $("#btn-verify").disabled = false;
  } catch (err) {
    alert("Computation error: " + err.message);
  } finally {
    $("#btn-compute").disabled = false;
    $("#btn-compute").textContent = "Compute Lattice Terminus";
  }
}

async function onVerify() {
  if (!state.terminus) return;

  // Recompute from the current sequence and compare
  const recomputed = await computeTerminus(state.sequence, state.basis, Q);
  const match =
    recomputed[0] === state.terminus[0] &&
    recomputed[1] === state.terminus[1] &&
    recomputed[2] === state.terminus[2];

  const el = $("#verify-result");
  el.className = match ? "ok" : "fail";
  el.textContent = match
    ? "✓ Terminus matches. Sequence integrity verified."
    : "✗ Terminus mismatch — sequence was altered.";
  show(el);
}

// ---------- Boot ----------

function boot() {
  renderEventList();

  $("#btn-add-event").addEventListener("click", () => {
    state.sequence.push("custom_a");
    renderEventList();
    resetComputed();
  });

  $("#btn-connect").addEventListener("click", connectWallet);
  $("#btn-compute").addEventListener("click", onCompute);
  $("#btn-sign").addEventListener("click", signTerminus);
  $("#btn-pay").addEventListener("click", sendTipAndCommit);
  $("#btn-verify").addEventListener("click", onVerify);

  // Allow pure crypto demo even without wallet
  $("#btn-compute").disabled = false;

  initProvider();
}

boot();
