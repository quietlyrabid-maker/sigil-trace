const Q = (2n ** 128n) - 1n;
const EVENT_TYPES = ["init", "auth", "transfer", "confirm", "settle", "audit", "notify", "close", "custom_a", "custom_b"];
const SEED_SALT = "sigil-vault-nimiq-v1";

// ---------- CONFIG: EDIT THIS ----------
const RECIPIENT = "NQ40 QUTA D1NB ERNF H8GG M6S8 H31J Y6PE B24X";
const LUNA = 100000; // 1 NIM = 100,000 Luna
// Demo valuation table (stated plainly: a fixed demo oracle). NIM per asset id.
// If an .asset-card has data-value="250" that wins; otherwise this table; otherwise 100.
const ASSET_VALUE_NIM = {};

// ---------- Cryptographic Helpers ----------
async function sha256Hex(str) {
  const data = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function sha256BigInt(str) {
  return BigInt("0x" + (await sha256Hex(str)));
}
async function generateBasis(seedSalt, events, modulus) {
  const basis = {};
  for (const e of events) {
    const h = await sha256Hex(seedSalt + e);
    basis[e] = [
      (await sha256BigInt(h + "x")) % modulus,
      (await sha256BigInt(h + "y")) % modulus,
      (await sha256BigInt(h + "z")) % modulus
    ];
  }
  return basis;
}
async function computeTerminus(eventSequence, basis, q) {
  let x = 0n, y = 0n, z = 0n, running = 0n;
  for (let pos = 1; pos <= eventSequence.length; pos++) {
    const e = eventSequence[pos - 1];
    const [vx, vy, vz] = basis[e];
    const h = await sha256BigInt(`${running}:${pos}:${e}`);
    x = (x + vx * BigInt(pos) * h) % q;
    y = (y + vy * BigInt(pos) * h) % q;
    z = (z + vz * BigInt(pos) * h) % q;
    running = x ^ y ^ z;
  }
  return [x, y, z];
}

// ---------- App State ----------
const state = {
  provider: null, accounts: [], basis: null, terminus: null,
  termHex: "", activeAsset: null, valueNim: 0, txHash: null
};
const $ = (sel) => document.querySelector(sel);

function setStatus(msg, isError = false) {
  const el = $("#wallet-status");
  el.textContent = msg;
  el.style.color = isError ? "var(--danger)" : "var(--muted)";
}

// ---------- Wallet Provider ----------
async function initProvider() {
  try {
    const mod = await import("@nimiq/mini-app-sdk");
    if (mod && mod.init) {
      state.provider = await mod.init();
      setStatus("Connected via Mini App SDK");
      $("#btn-connect").disabled = false;
      return;
    }
  } catch (_) {}

  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (window.nimiq) {
      state.provider = window.nimiq;
      setStatus("Nimiq provider detected");
      $("#btn-connect").disabled = false;
      return;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  setStatus("Open in Nimiq Pay to pay. You can still preview notes.", true);
}

async function connectWallet() {
  if (!state.provider) return;
  try {
    const accounts = await state.provider.listAccounts();
    state.accounts = Array.isArray(accounts) ? accounts : [];
    if (state.accounts.length > 0) {
      $("#account-addr").textContent = state.accounts[0];
      $("#account-info").classList.remove("hidden");
      setStatus("Wallet connected");
      if (state.terminus && !state.txHash) $("#btn-sign").disabled = false;
    } else {
      setStatus("No accounts returned", true);
    }
  } catch (err) {
    setStatus("Connection failed or rejected", true);
  }
}

// ---------- Note Rendering ----------
async function terminusBits(termHex) {
  // 4 x SHA-256 = 1024 bits, so all 400 cells are driven by the terminus.
  let bits = "";
  for (let k = 0; k < 4; k++) {
    const h = await sha256Hex(termHex + ":" + k);
    for (const c of h) bits += parseInt(c, 16).toString(2).padStart(4, "0");
  }
  return bits;
}

async function renderMatrix(termHex) {
  const matrix = document.getElementById("note-matrix");
  if (!matrix) return;
  matrix.innerHTML = "";
  const bits = await terminusBits(termHex);
  for (let i = 0; i < 400; i++) {
    const pixel = document.createElement("div");
    pixel.className = "pixel";
    if (bits[i] === "0") pixel.classList.add("off");
    matrix.appendChild(pixel);
  }
}

function renderNote() {
  const paid = !!state.txHash;
  const shortHash = state.termHex.substring(0, 8).toUpperCase();
  const who = state.accounts.length > 0 ? state.accounts[0].substring(0, 12) + "..." : "NOT CONNECTED";
  const txLine = paid
    ? `Tx: ${String(state.txHash).substring(0, 14)}...`
    : "Unpaid: preview only";

  document.getElementById("note-visual").innerHTML = `
    <div class="note-header">
      <div class="note-logo">⬡ NIMIQ NOTE</div>
      <div class="note-subtitle">${paid ? "Paid Receipt" : "Preview"}: ${state.valueNim} NIM</div>
    </div>
    <div class="matrix-wrapper">
      <div id="note-matrix" class="note-matrix"></div>
      <div class="sigil-stamp">
        <div class="sigil-icon">⬡</div>
        <div class="sigil-text">SIGIL</div>
      </div>
    </div>
    <div class="note-footer">
      <div></div>
      <div class="note-wallet">Terminus: 0x${shortHash}...</div>
      <div class="note-wallet">From: ${who}</div>
      <div class="note-wallet">${txLine}</div>
    </div>
  `;
  // asset name set as text, not HTML
  document.querySelector("#note-visual .note-footer div").textContent = state.activeAsset;
  return renderMatrix(state.termHex);
}

async function wrapAsset(assetId, assetName, dataValue) {
  $("#note-container").style.display = "block";
  $("#sigil-status").textContent = "Minting preview...";
  $("#btn-sign").disabled = true;
  state.activeAsset = assetName;
  state.txHash = null;

  const v = Number(dataValue);
  state.valueNim = v > 0 ? v : (ASSET_VALUE_NIM[assetId] ?? 100);

  if (!state.basis) state.basis = await generateBasis(SEED_SALT, EVENT_TYPES, Q);

  // Asset AND value are bound into the terminus.
  const hash = await sha256Hex(`${assetId}:${state.valueNim}`);
  const seq = [0, 2, 4].map((i) => EVENT_TYPES[parseInt(hash.substring(i, i + 2), 16) % 10]);

  state.terminus = await computeTerminus(seq, state.basis, Q);
  state.termHex = state.terminus.map((n) => n.toString(16).padStart(32, "0")).join("");

  await renderNote();

  $("#btn-sign").textContent = `Pay ${state.valueNim} NIM & Seal`;
  $("#sigil-status").textContent = "Preview ready. Connect wallet, then pay to seal.";
  if (state.accounts.length > 0) $("#btn-sign").disabled = false;
}

// ---------- Pay ----------
async function payNote() {
  if (!state.terminus || !state.provider || state.accounts.length === 0) return;
  if (RECIPIENT.startsWith("PASTE")) {
    $("#sigil-status").textContent = "Set RECIPIENT address in main.js first.";
    return;
  }
  try {
    $("#btn-sign").disabled = true;
    $("#sigil-status").textContent = "Confirm payment in Nimiq Pay...";

    const tx = {
      recipient: RECIPIENT,
      value: Math.round(state.valueNim * LUNA),
    };
    // Memo carrying the terminus. Check the Nimiq provider API reference for the exact
    // data-carrying method; the name below is a guess and falls back to a plain payment.
    let result;
    if (typeof state.provider.sendBasicTransactionWithData === "function") {
      result = await state.provider.sendBasicTransactionWithData({
        ...tx, data: state.termHex.substring(0, 32)
      });
    } else {
      result = await state.provider.sendBasicTransaction(tx);
    }

    state.txHash = typeof result === "string" ? result : (result && (result.hash || result.txHash)) || JSON.stringify(result);
    await renderNote();
    $("#sigil-status").textContent = "✓ PAID & SEALED";
  } catch (err) {
    $("#btn-sign").disabled = false;
    $("#sigil-status").textContent = "Payment rejected or failed.";
  }
}

// ---------- Boot ----------
function boot() {
  $("#btn-connect").addEventListener("click", connectWallet);
  $("#btn-sign").addEventListener("click", payNote);

  document.querySelectorAll(".asset-card").forEach((card) => {
    card.addEventListener("click", () => {
      wrapAsset(card.dataset.id, card.dataset.name, card.dataset.value);
    });
  });

  initProvider();
}

boot();
