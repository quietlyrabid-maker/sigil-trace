const Q = (2n ** 128n) - 1n;
const EVENT_TYPES = ["init", "auth", "transfer", "confirm", "settle", "audit", "notify", "close", "custom_a", "custom_b"];
const SEED_SALT = "sigil-vault-nimiq-v1";

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
const state = { provider: null, accounts: [], basis: null, terminus: null, activeAsset: null };
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
      state.provider = await mod.init({ timeout: 12000 });
      setStatus("Connected via Mini App SDK");
      $("#btn-connect").disabled = false; return;
    }
  } catch (_) {}
  
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (window.nimiq) { state.provider = window.nimiq; setStatus("Nimiq provider detected"); $("#btn-connect").disabled = false; return; }
    await new Promise((r) => setTimeout(r, 300));
  }
  setStatus("Open in Nimiq Pay to sign. You can still generate notes.", true);
}

async function connectWallet() {
  if (!state.provider) return;
  try {
    if (state.provider.listAccounts) {
      const accounts = await state.provider.listAccounts();
      state.accounts = Array.isArray(accounts) ? accounts : [];
    }
    if (state.accounts.length > 0) {
      $("#account-addr").textContent = state.accounts[0];
      $("#account-info").classList.remove("hidden");
      setStatus("Wallet connected");
      $("#btn-sign").disabled = false;
    }
  } catch (err) { setStatus("Connection failed", true); }
}

// ---------- The Nimiq Note Rendering ----------
function renderMatrix(assetId) {
  const matrix = document.getElementById('note-matrix');
  matrix.innerHTML = '';
  
  let hash = 0;
  for (let i = 0; i < assetId.length; i++) {
    hash = ((hash << 5) - hash) + assetId.charCodeAt(i);
    hash |= 0;
  }

  for (let i = 0; i < 400; i++) {
    const pixel = document.createElement('div');
    pixel.className = 'pixel';
    if (((hash >> (i % 32)) & 1) === 0) {
      pixel.classList.add('off');
    }
    matrix.appendChild(pixel);
  }
}

async function wrapAsset(assetId, assetName) {
  // Show the note
  $("#note-container").style.display = "block";
  $("#sigil-status").textContent = "Minting Note...";
  $("#btn-sign").disabled = true;
  state.activeAsset = assetName;

  if (!state.basis) state.basis = await generateBasis(SEED_SALT, EVENT_TYPES, Q);
  
  // Map the asset ID to a sequence to create the terminus
  const hash = await sha256Hex(assetId);
  const seq = [
    EVENT_TYPES[parseInt(hash.substring(0,2), 16) % 10],
    EVENT_TYPES[parseInt(hash.substring(2,4), 16) % 10],
    EVENT_TYPES[parseInt(hash.substring(4,6), 16) % 10]
  ];

  state.terminus = await computeTerminus(seq, state.basis, Q);
  
  // Draw the visual Note
  const shortHash = state.terminus[0].toString(16).substring(0, 8).toUpperCase();
  
  document.getElementById('note-visual').innerHTML = `
    <div class="note-header">
      <div class="note-logo">⬡ NIMIQ NOTE</div>
      <div class="note-subtitle">Bearer Asset</div>
    </div>
    <div class="matrix-wrapper">
      <div id="note-matrix" class="note-matrix"></div>
      <div class="sigil-stamp">
        <div class="sigil-icon">⬡</div>
        <div class="sigil-text">SIGIL</div>
      </div>
    </div>
    <div class="note-footer">
      <div>${assetName}</div>
      <div class="note-wallet">Terminus: 0x${shortHash}...</div>
      <div class="note-wallet">Signed by: ${state.accounts.length > 0 ? state.accounts[0].substring(0,12) + '...' : 'UNSIGNED'}</div>
    </div>
  `;
  
  renderMatrix(assetId);
  
  $("#sigil-status").textContent = "Note minted.";
  if (state.accounts.length > 0) $("#btn-sign").disabled = false;
}

async function signNote() {
  if (!state.terminus || !state.provider || state.accounts.length === 0) return;
  
  const msg = `Sigil Vault Asset\nAsset: ${state.activeAsset}\nTerminus: ${state.terminus[0].toString(16)}`;
  
  try {
    $("#sigil-status").textContent = "Awaiting wallet signature...";
    let sig;
    if (state.provider.sign) sig = await state.provider.sign(msg);
    else throw new Error("No sign method available");
    
    $("#sigil-status").textContent = "✓ NIMIQ ATTESTED";
    $("#btn-sign").disabled = true;
  } catch (err) {
    $("#sigil-status").textContent = "Signature rejected.";
  }
}

// ---------- Boot ----------
function boot() {
  $("#btn-connect").addEventListener("click", connectWallet);
  $("#btn-sign").addEventListener("click", signNote);
  
  document.querySelectorAll(".asset-card").forEach(card => {
    card.addEventListener("click", () => {
      wrapAsset(card.dataset.id, card.dataset.name);
    });
  });

  initProvider();
}

boot();
