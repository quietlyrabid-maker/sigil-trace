# Sigil Trace

**Wrap any asset. Own the proof. Mint a Nimiq Note.**

Built for the Nimiq Mini Apps Competition (Cycle 3). 

## The Problem
A gift card code is just a string. A ticket is just a barcode. A receipt is just a PDF. None of them are cryptographically bound to *your* wallet in a way that proves *you* own them and they haven't been tampered with. You have to trust the issuer, the platform, and the database.

## The Solution: The Nimiq Note
Sigil Trace turns any asset into a **bearer instrument**. You put an asset (a gift card, a ticket, a payment sequence) into the Vault. The engine wraps it in a cryptographic state chain and spits out a **Nimiq Note**. 

The Note is a visual, scannable graphic that acts like digital cash. Whoever holds the Note, owns the asset. The math proves it wasn't forged, replayed, or tampered with. 

## How It Works
1. **Wrap:** Select an asset in the Vault.
2. **Mint:** The CPKC engine (Coupled-Pair Keyed Chain) locks the asset into a unique mathematical terminus. 
3. **Sign:** Your Nimiq wallet signs the terminus, stamping the Note with your identity.
4. **Transfer:** Send the Note to someone else. They can verify it instantly without seeing your private data.

## Why It's Secure
- **Tamper-Evident:** Change one digit in the asset, and the entire Note breaks. (Proven in Python: 4/4 adversarial attacks repelled).
- **Replay-Proof:** Once the Note is spent, it is burned. You cannot spend it twice.
- **Zero-Knowledge:** The Note proves ownership without revealing the underlying asset code or the transaction history.

## Tech Stack
- Pure JavaScript (BigInt + Web Crypto API) for the browser app.
- CPKC (Coupled-Pair Keyed Chain) for the math.
- Nimiq Mini Apps SDK for wallet integration.
- MIT License.

## Built by David James Swindle
Built on a borrowed laptop and a Galaxy phone by the very kind of person this tech was built for, and in the same spirit the Nimiq payment system was developed to assist. Freedom. Freedom from the structures that keep the power of financial transactions in the hands of the few, so we can all take part equally in the ability to own and spend without restriction the value we all should have the right to share.
