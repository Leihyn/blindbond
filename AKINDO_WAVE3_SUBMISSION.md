# AKINDO Wave 3 Submission — copy/paste fields

Paste the sections below directly into the AKINDO submission form for BlindBond.

---

## Product Category (max 3)

```
DeFi
Sealed-Bid Auction
Lending
```

---

## Updates in this Wave (Wave 3)

**Wave 3: From encrypted bids to encrypted positions.**

Wave 2 judge feedback (Alex_Fhenix): *"Nice concept, try to work with confidential tokens for next waves."* This wave delivers exactly that.

**What changed**

1. **ConfidentialToken (FHERC20)** — new contract `contracts/ConfidentialToken.sol`. Balances stored as `euint64`, transfers happen on ciphertext, approvals use an operator model instead of ERC20 allowances (allowances would leak balance information through gas patterns).

2. **End-to-end encrypted lender lifecycle.** `submitRate` (deposit), `settle` (winner payout to borrower + losers refunded), `claim` (winner principal+interest after repay), `claimRefund` (cancelled bonds), and `repay` (borrower pays back) all transact through encrypted balances. An on-chain observer sees ciphertext hashes — never dollar amounts. Rates AND positions are private.

3. **Per-payout encrypted refund.** Each refund creates its own `euint64` so ACL grants are scoped per-bid rather than leaking aggregate pool size.

4. **Test coverage expanded.** Added `test/ConfidentialTokenFlows.ts` — three flow tests covering encrypted deposit (mint + unseal), operator-model approval (revert without `setOperator`, succeed after), per-payout encrypted refund. Existing 17-test suite migrated to the FHERC20 path.

5. **Demo scripts.** `scripts/seed-bond.ts` (one-command judge walkthrough, 5 encrypted bids on Arbitrum Sepolia), `scripts/publish-and-settle.ts` (resolve → publish → settle), `scripts/full-demo.ts` rewrite (full lifecycle in one command).

6. **Frontend rebuild.** Bond-lifecycle UI in `App.tsx`/`App.css`, Vite asset pipeline (favicon, hero, icons), `vercel.json` for deployment.

7. **Documentation.** `CHANGELOG.md` (per-wave progress log), `WAVE3_UPDATE.md` (this update + verification commands), `DEMO-SCRIPT.md` (narrated walkthrough).

**Wave 2 → Wave 3 diff**

| Surface | Wave 2 | Wave 3 |
|---|---|---|
| Bid privacy | encrypted | encrypted |
| Position privacy | plaintext ERC20 | encrypted FHERC20 |
| Lender deposits | `MockERC20.transferFrom` | `ConfidentialToken.confidentialTransferFrom` |
| Settlement payout | plaintext | encrypted |
| Refund | plaintext pool | per-bid encrypted ACL |
| Tests | 17 | 20 (3 new FHERC20 flows) |

**How to verify**
- Tests: `npx hardhat test`
- Live seed (Arbitrum Sepolia): `npx hardhat run scripts/seed-bond.ts --network arb-sepolia`
- Full lifecycle: `npx hardhat run scripts/full-demo.ts --network arb-sepolia`
- App: https://blindbond.vercel.app

**Commits this wave:** `bfef53a` (ConfidentialToken integration), `39ef564` (changelog + AKINDO update + flow tests). Repo: https://github.com/Leihyn/blindbond

---

## Milestone — 4th Wave (build goals)

**Wave 4 build goals**

a. **Variable-size encrypted positions.** Replace fixed slots with per-lender `euint64` deposit amounts so position size is private end-to-end (today the slot count is plaintext; lenders leak the fact they took exactly one slot).

b. **Selective-disclosure regulator flow in the UI.** Borrower-initiated unseal of winning bids to a designated regulator address, with on-chain audit trail and a UI walkthrough on the live app.

c. **On-chain test traces.** Annotated Arbiscan tx links for the full lifecycle (create → bid × N → resolve → settle → repay → claim) with explanations of which fields are encrypted vs plaintext at each step.

d. **Borrower repayment via FHERC20 transferFrom path.** Today the borrower must `setOperator` then `repay`; collapse into a single permit-style flow with deadline.

e. **Multi-bond UI.** Browse open auctions, filter by collateral type, sort by max-rate ceiling. Today the frontend handles one bond at a time.

f. **Mainnet-readiness checklist.** Slither, mythril, and CoFHE-specific ACL audit pass. Document every `FHE.allow` call site with intent.

---

## Milestone — 5th Wave (build goals)

**Wave 5 build goals (final)**

a. **Live institutional pilot.** One live bond auction on Arbitrum Sepolia run with real lenders (target: 10+ bidders, 3+ slots) end-to-end, proving the iterated-tournament resolution at scale.

b. **Compliance disclosure case study.** Document a full regulator unseal flow start-to-finish — the selective-disclosure story that distinguishes BlindBond from generic dark pools.

c. **Mainnet-readiness security review.** Trail of Bits-style code-maturity assessment + slither + custom CoFHE ACL audit. Public report committed to the repo.

d. **Spec document (`SPEC.md`).** Formal description of the iterated-tournament uniform-price mechanism, ACL invariants, and FHERC20 integration so a third party could re-implement it.

e. **Pitch + investor deck.** 10-slide deck framing BlindBond as the on-chain analog of Treasury sealed-bid auctions ($2T/year market), with the institutional-rails narrative the buildathon explicitly calls out.

f. **Wave-5 demo video.** End-to-end recording showing real-time encryption, on-chain resolution, settlement, and regulator disclosure — the full thesis in 3 minutes.

---

## Comment to leave on the project page after submitting

> @Alex_Fhenix Wave 3: integrated ConfidentialToken (FHERC20) per your Wave 2 feedback. Lender deposits, payouts, refunds now flow through encrypted balances. Commits `bfef53a` + `39ef564`. Wave-3 writeup: https://github.com/Leihyn/blindbond/blob/main/WAVE3_UPDATE.md
