# Wave 3 Update — BlindBond

**Submitted: 2026-05-04**
**Repo:** https://github.com/Leihyn/blindbond
**Wave 3 commit:** `bfef53a`
**Live app:** https://blindbond.vercel.app

---

## Direct response to Wave 2 feedback

Alex_Fhenix wrote: *"Nice concept, try to work with confidential tokens for next waves."*

Done. Every lender flow in BlindBond is now FHERC20-native.

- New file: [`contracts/ConfidentialToken.sol`](./contracts/ConfidentialToken.sol) — full FHERC20 with `euint64` balances, ciphertext transfers, operator-model approvals (ERC20 allowances would leak balance info through gas).
- Wired through: `submitRate` (deposit), `settle` (payout to borrower + refund losers), `claim` (winner payout post-repay), `claimRefund` (cancelled bonds), `repay` (borrower → contract).
- Result: an on-chain observer sees ciphertext hashes, never dollar amounts. **Rates *and* positions are private.** This is the architectural difference between "confidential bids" and "confidential lending."

## What's new this wave

| Area | Wave 2 | Wave 3 |
|---|---|---|
| Bid privacy | encrypted (`euint64`) | encrypted |
| Position privacy | **plaintext ERC20 balances** | **encrypted FHERC20 balances** |
| Lender deposits | `MockERC20.transferFrom` | `ConfidentialToken.confidentialTransferFrom` |
| Settlement payout | plaintext | encrypted |
| Refund path | plaintext | encrypted, per-bid `euint64` ACL |
| Test coverage | 17 tests, ERC20 path | 20 tests, FHERC20 path + 3 dedicated FHERC20 flow tests |
| Demo scripts | `full-demo.ts` only | `seed-bond.ts`, `publish-and-settle.ts`, `full-demo.ts` rewrite |
| Frontend | functional | bond-lifecycle UI rebuild, Vite assets, vercel.json |

See [`CHANGELOG.md`](./CHANGELOG.md) for the per-file diff.

## How to verify

```bash
# Local — runs the FHERC20 lifecycle in Hardhat
npx hardhat test

# Arbitrum Sepolia — seed a real bond with 5 encrypted bids
npx hardhat run scripts/seed-bond.ts --network arb-sepolia

# Arbitrum Sepolia — full lifecycle in one command
npx hardhat run scripts/full-demo.ts --network arb-sepolia
```

Then open https://blindbond.vercel.app to walk the resolved bond through the UI.

## Why this matters for the rubric

- **Privacy Architecture:** Confidentiality is now end-to-end, not just at the bid layer. The judge feedback identified the gap; this wave closes it.
- **Technical Execution:** New tests cover the encrypted deposit, encrypted refund, and encrypted payout paths against the FHERC20 contract directly — independent of the auction logic.
- **Innovation:** The combination of *iterated tournament resolution on ciphertext* + *uniform-price clearing* + *FHERC20 lender flows* is, to our knowledge, novel on Fhenix CoFHE.

## What's coming in Wave 4

- Per-lender encrypted *position size* (variable-size bids, not fixed slots)
- Compliance-mode selective disclosure flow exercised via the UI (regulator unseal)
- On-chain integration test posting full lifecycle traces to Arbiscan with annotated tx links

— faruukku
