# BlindBond

**Encrypted rate discovery for on-chain credit.**

DeFi lending rates are set by formulas, not markets. Aave and Compound use utilization curves — transparent, gameable, and with no genuine price discovery. Institutional lenders won't participate because their bidding strategies leak on-chain.

In TradFi, the US Treasury issues $2 trillion in bonds every year through sealed-bid auctions. That mechanism doesn't exist on-chain because "sealed bid" on a transparent blockchain is an oxymoron.

BlindBond fixes this with Fully Homomorphic Encryption. Lenders submit FHE-encrypted interest rate bids. An iterated tournament bracket finds the clearing rate by computing directly on ciphertext — without decrypting any individual bid. All winning lenders earn the same uniform clearing rate. Individual bid rates stay encrypted forever.

**17 passing tests. Deployed on Arbitrum Sepolia with live FHE encryption. Full lifecycle verified on-chain.**

**[Live App](https://frontend-two-phi-72.vercel.app)** | Built on [Fhenix CoFHE](https://docs.fhenix.io)

> **Judges:** Run `npx hardhat run scripts/full-demo.ts --network arb-sepolia` to see the complete lifecycle in one command — creates a bond, funds 3 lender wallets, encrypts and submits 3 rate bids, waits for deadline, resolves 2 tournament passes on encrypted data, settles at the clearing rate, borrower repays, lenders claim. No MetaMask required.

## How It Works

```
Borrower                Lenders              Contract (FHE)           Settlement
────────                ───────              ──────────────           ──────────
Post collateral    →    Bid encrypted    →   K tournament passes  →  Clearing rate
Define loan terms       rates (FHE)          on ciphertext            = K-th lowest
                        One tx each          No decryption            All winners
                                             No reveal phase          earn same rate
```

**1. Create Bond**: Borrower locks collateral, defines loan size (split into K slots), max rate, and duration.

**2. Bid Encrypted Rates**: Each lender encrypts their rate client-side using TFHE WASM, then submits a single transaction containing only ciphertext. The plaintext rate never touches the network.

**3. Iterated Tournament** (K passes): Each pass finds the lowest encrypted rate among non-excluded bids using `FHE.lt` comparisons. The winner is marked and excluded for the next pass. After K passes, the K-th lowest rate = clearing rate.

**4. Uniform Price Settlement**: All K winners earn the clearing rate (the marginal winner's own rate). This is not Vickrey (second-price) — the clearing rate is the marginal winner's actual bid. Losers get full deposits back immediately.

## From VeilBid to BlindBond

BlindBond is the second FHE auction protocol we've built.

**[VeilBid](https://github.com/Leihyn/cipherpool)** (Zama fhEVM) was a Vickrey (second-price sealed-bid) auction — 27 tests, 14 FHE primitives, deployed on Ethereum Sepolia. The highest bidder wins, pays the second-highest price. Truthful bidding is the dominant strategy. It works for single-unit auctions: one NFT, one block of tokens, one license.

**The problem:** Credit markets aren't single-unit. A borrower needs $500K — they can't rely on one lender filling the whole thing. Real bond markets have multiple lenders filling one issuance. Vickrey doesn't scale to this. VCG (the multi-unit equivalent) has quadratic FHE cost.

**BlindBond** solves this with a different mechanism:
- **Uniform price** instead of second-price — the clearing rate is the marginal winner's own rate, not someone else's bid
- **Iterated tournament** instead of single-pass — K passes find K winners, reusing VeilBid's tournament bracket and first-match exclusion pattern
- **Multi-lender** by design — K slots, K winners, one clearing rate

The FHE primitives are the same (`lt`, `eq`, `select`, `and`, `or`, `not`). The economic mechanism is fundamentally different. This is new work, not a port.

## Proven on Arbitrum Sepolia

Full end-to-end lifecycle verified with live CoFHE:

```
3 lenders bid encrypted rates: 3.00%, 4.50%, 3.80%
2-pass iterated tournament on ciphertext
  Pass 1: lowest = 3.00% → Lender A wins, excluded
  Pass 2: lowest = 3.80% → Lender C wins → CLEARING RATE

Result:
  Lender A (bid 3.00%) → WINS → earns 3.80%
  Lender C (bid 3.80%) → WINS → earns 3.80%
  Lender B (bid 4.50%) → LOSES → refunded 100 USDC

Nobody — not the borrower, not other lenders, not chain observers —
can see any individual bid rate. Only the clearing rate is revealed.
```

Gas costs (Arbitrum Sepolia):
| Operation | Gas |
|---|---|
| submitRate (encrypted bid) | ~430K |
| resolvePass (per pass) | ~1M |
| settle | ~350K |

## Contract Addresses (Arbitrum Sepolia)

| Contract | Address |
|---|---|
| BondAuction | [`0xD916970FE36541A0a71Db13415CfFBFF005e761e`](https://sepolia.arbiscan.io/address/0xD916970FE36541A0a71Db13415CfFBFF005e761e) |
| USDC (Mock) | [`0xcC86944f5E7385cA6Df8EEC5d40957840cfdfbb2`](https://sepolia.arbiscan.io/address/0xcC86944f5E7385cA6Df8EEC5d40957840cfdfbb2) |
| WETH (Mock) | [`0x55Bd48C34441FEdA5c0D45a2400976fB933Abb7e`](https://sepolia.arbiscan.io/address/0x55Bd48C34441FEdA5c0D45a2400976fB933Abb7e) |

## FHE Operations per Pass

Each tournament pass uses 7 FHE operations per bid:

| Operation | Purpose |
|---|---|
| `FHE.select` | Adjust excluded bids to MAX_RATE |
| `FHE.lt` | Tournament bracket (find minimum) |
| `FHE.select` | Conditional minimum update |
| `FHE.eq` | First-match identification |
| `FHE.and` / `FHE.not` | Ensure only first match selected |
| `FHE.or` | Update exclusion flags |

For K=5 slots, N=20 bidders: ~700 FHE operations across 5 transactions.

## Privacy Model

| Data | Visibility |
|---|---|
| Bond parameters (collateral, borrow amount, max rate) | Public |
| Bidder addresses and bid count | Public |
| Deposit amount (fixed, same for all) | Public |
| **Individual bid rates** | **Encrypted. Never revealed.** |
| **Winning bids** | **Encrypted. Only via compliance grant.** |
| Clearing rate (K-th lowest) | Public after settlement |
| Winner identities | Public after settlement |

## Compliance: Selective Disclosure

The borrower or any winner can grant a regulator decryption access to specific rate bids:

```solidity
auction.revealForCompliance(bondId, regulatorAddress);
// Regulator can now decrypt winning bid rates via FHE.allow
```

The market sees the clearing rate (public by design). Individual losing bids are never revealed to anyone.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                        BROWSER                           │
│                                                          │
│  Lender enters rate (plaintext, never leaves browser)    │
│       │                                                  │
│       ▼                                                  │
│  @cofhe/sdk encrypts rate + generates ZK proof           │
│       │                                                  │
│       ▼                                                  │
│  CoFHE verifier validates proof                          │
│       │                                                  │
│       ▼                                                  │
│  Transaction: encrypted handle + signature               │
│  (plaintext rate is NOT in calldata)                     │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│                  ARBITRUM SEPOLIA                         │
│                                                          │
│  BondAuction.sol                                         │
│    createBond()     — lock collateral, define terms      │
│    submitRate()     — store encrypted rate, take deposit  │
│    resolvePass()    — one tournament pass (called K×)     │
│    settle()         — read clearing rate, transfer funds  │
│    repay() / claim() / liquidate()                       │
│                                                          │
│  FHE operations executed by Fhenix CoFHE coprocessor     │
└─────────────────────────────────────────────────────────┘
```

## Quick Start

```bash
# Install and run tests (local Hardhat with FHE mock)
npm install
npx hardhat compile
npx hardhat test          # 17/17 passing

# Deploy to Arbitrum Sepolia
cp .env.example .env
# Add your PRIVATE_KEY to .env (needs Arb Sepolia ETH)
npx hardhat run scripts/deploy-sequential.ts --network arb-sepolia

# *** THE DEMO — run this to see everything work ***
npx hardhat run scripts/full-demo.ts --network arb-sepolia
# Creates bond, funds 3 lenders, encrypts 3 rate bids with FHE,
# resolves tournament, settles at clearing rate, repays, claims.
# ~5 minutes end-to-end. No MetaMask needed.

# Run the frontend (for individual wallet interaction)
cd frontend && npm install && npm run dev
```

## File Structure

```
contracts/
  BondAuction.sol       Iterated tournament + uniform price settlement (380 lines)
  MockERC20.sol         Standard ERC-20 for collateral and borrow tokens

scripts/
  deploy.ts             Deploy to Hardhat or testnet
  deploy-sequential.ts  Deploy with retries (flaky RPC)
  e2e-testnet.ts        Single-bid E2E test on live testnet
  full-demo.ts          Full lifecycle: 3 lenders, 2 passes, settle, repay, claim

test/
  BondAuction.ts        17 tests: creation, bidding, resolution, settlement,
                        repayment, claims, liquidation, refunds, compliance

frontend/
  src/App.tsx           React UI with wallet connect + CoFHE encryption
  src/abi.ts            Contract ABIs
  src/config.ts         Wagmi + Arbitrum Sepolia config
```

## Troubleshooting

**"BondAuction: clearing rate not decrypted yet"**
The CoFHE threshold network hasn't processed the decryption yet. Wait 10-15 seconds after the final resolve pass, then call settle.

**"BondAuction: borrower cannot bid"**
The borrower's address tried to bid on their own bond. Use a different wallet.

**"BondAuction: deadline passed" on submitRate**
FHE encryption takes 10-30 seconds per bid on testnet. If your bidding window is too short, bids won't land in time. Use 300+ seconds for multi-bid demos.

**TLS socket errors during deployment**
The public Arbitrum Sepolia RPC drops connections intermittently. Use `deploy-sequential.ts` which has retry logic, or set a private RPC in `.env`.

## Built With

- [Fhenix CoFHE](https://docs.fhenix.io) / [@fhenixprotocol/cofhe-contracts](https://www.npmjs.com/package/@fhenixprotocol/cofhe-contracts)
- [@cofhe/sdk](https://www.npmjs.com/package/@cofhe/sdk) (TFHE WASM + ZK proof generation)
- [@cofhe/hardhat-plugin](https://www.npmjs.com/package/@cofhe/hardhat-plugin)
- [Hardhat](https://hardhat.org/)
- React, Vite, Wagmi, Viem
- Arbitrum Sepolia testnet
