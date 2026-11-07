# Sigil Trace

**Verifiable execution traces inside Nimiq Pay.**

Built for the Nimiq Mini Apps Competition. 

## The Problem
When an AI agent, a payment plan, or a multi-step workflow executes, it leaves a trail. But proving *which* steps were followed usually requires exposing the entire trail. This is a privacy nightmare and a security risk (e.g., replay attacks, where a valid command is reused maliciously).

## The Solution: The Terminus
Sigil Trace lets a user prove a sequence of events happened—in an exact order—without revealing the events themselves. 

1. Define your sequence (e.g., `init → auth → transfer`).
2. Compute the **Terminus**: A 3-dimensional key is moved through modular space (\(Z_q^3\)) using hash-chained, position-weighted accumulation. Change one step, and the terminus changes completely.
3. Sign the Terminus with your Nimiq wallet. 
4. The signature is a non-repudiable proof that *this exact path* occurred.

## Why It's Secure
- **Tamper-Evident:** The `running = x ^ y ^ z` feedback loop means each step depends on the entire previous state. Any change alters the final fingerprint.
- **Replay-Proof:** The terminus is deterministic. A signed terminus cannot be reused for a different sequence.
- **Client-Side:** Zero backend. The math runs in the browser, and the wallet signs locally. No data leaves the user's device.

## How to Run
This is a static web app. 
1. Clone the repo.
2. Run `python -m http.server 8080` (or any static file server).
3. Open the URL inside Nimiq Pay to enable wallet signing. (You can also open it in a normal browser to test the math without the wallet).

## Tech Stack
- Pure JavaScript (BigInt + Web Crypto API). No external cryptographic dependencies.
- Nimiq Mini Apps SDK (for wallet integration).
- MIT License.

## Built by
A solo developer, David James Swindle on a borrowed laptop and a Galaxy phone. Because the truth shouldn't require a data center.
