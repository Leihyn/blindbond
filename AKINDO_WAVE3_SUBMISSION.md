AKINDO Wave 3 submission — copy/paste fields (plain text, no markdown)


==============================================================
PRODUCT CATEGORY (max 3)
==============================================================

DeFi
Sealed-Bid Auction
Lending


==============================================================
UPDATES IN THIS WAVE (Wave 3)
==============================================================

Wave 3: From encrypted bids to encrypted positions.

Wave 2 judge feedback (Alex_Fhenix): "Nice concept, try to work with confidential tokens for next waves." This wave delivers exactly that.

What changed:

1. ConfidentialToken (FHERC20) — new contract contracts/ConfidentialToken.sol. Balances stored as euint64, transfers happen on ciphertext, approvals use an operator model instead of ERC20 allowances (allowances would leak balance information through gas patterns).

2. End-to-end encrypted lender lifecycle. submitRate (deposit), settle (winner payout to borrower + losers refunded), claim (winner principal+interest after repay), claimRefund (cancelled bonds), and repay (borrower pays back) all transact through encrypted balances. An on-chain observer sees ciphertext hashes — never dollar amounts. Rates AND positions are private.

3. Per-payout encrypted refund. Each refund creates its own euint64 so ACL grants are scoped per-bid rather than leaking aggregate pool size.

4. Test coverage expanded. Added test/ConfidentialTokenFlows.ts — three flow tests covering encrypted deposit (mint + unseal), operator-model approval (revert without setOperator, succeed after), per-payout encrypted refund. Existing 17-test suite migrated to the FHERC20 path.

5. Demo scripts. scripts/seed-bond.ts (one-command judge walkthrough, 5 encrypted bids on Arbitrum Sepolia), scripts/publish-and-settle.ts (resolve → publish → settle), scripts/full-demo.ts rewrite (full lifecycle in one command).

6. Frontend rebuild. Bond-lifecycle UI in App.tsx and App.css, Vite asset pipeline (favicon, hero, icons), vercel.json for deployment.

7. Documentation. CHANGELOG.md (per-wave progress log), WAVE3_UPDATE.md (this update + verification commands), DEMO-SCRIPT.md (narrated walkthrough).

Wave 2 → Wave 3 diff:

- Bid privacy: encrypted in both waves.
- Position privacy: plaintext ERC20 in Wave 2, encrypted FHERC20 in Wave 3.
- Lender deposits: MockERC20.transferFrom in Wave 2, ConfidentialToken.confidentialTransferFrom in Wave 3.
- Settlement payout: plaintext in Wave 2, encrypted in Wave 3.
- Refund: plaintext pool in Wave 2, per-bid encrypted ACL in Wave 3.
- Tests: 17 in Wave 2, 20 in Wave 3 (3 new FHERC20 flows).

How to verify:

- Tests: npx hardhat test
- Live seed (Arbitrum Sepolia): npx hardhat run scripts/seed-bond.ts --network arb-sepolia
- Full lifecycle: npx hardhat run scripts/full-demo.ts --network arb-sepolia
- App: https://blindbond.vercel.app

Commits this wave: bfef53a (ConfidentialToken integration), 39ef564 (changelog + AKINDO update + flow tests). Repo: https://github.com/Leihyn/blindbond


==============================================================
MILESTONE — 4TH WAVE (max 1,000 chars)
==============================================================

Wave 4 build goals:

a. Variable-size encrypted positions. Replace fixed slots with per-lender euint64 deposit amounts so position size is private end-to-end (today the slot count is plaintext).

b. Selective-disclosure regulator flow in the UI. Borrower-initiated unseal of winning bids to a designated regulator address, with on-chain audit trail.

c. Annotated Arbiscan tx links for the full lifecycle (create → bid × N → resolve → settle → repay → claim).

d. Permit-style FHERC20 repayment — collapse setOperator + repay into a single deadline-bound flow.

e. Multi-bond UI: browse open auctions, filter by collateral, sort by max-rate.

f. Mainnet-readiness checklist: Slither, mythril, custom CoFHE ACL audit; document every FHE.allow site.


==============================================================
MILESTONE — 5TH WAVE (max 1,000 chars)
==============================================================

Wave 5 build goals (final):

a. Live institutional pilot — one live bond auction on Arbitrum Sepolia with 10+ real lenders end-to-end, proving iterated-tournament resolution at scale.

b. Compliance disclosure case study. Full regulator unseal flow start-to-finish — the selective-disclosure story that distinguishes BlindBond from generic dark pools.

c. Mainnet-readiness security review: Trail of Bits-style code-maturity assessment, Slither, custom CoFHE ACL audit. Public report in the repo.

d. SPEC.md — formal description of the iterated-tournament uniform-price mechanism, ACL invariants, and FHERC20 integration so a third party could re-implement it.

e. 10-slide investor deck framing BlindBond as the on-chain analog of Treasury sealed-bid auctions ($2T/year market).

f. Wave-5 demo video: real-time encryption, on-chain resolution, settlement, regulator disclosure — full thesis in 3 minutes.


==============================================================
COMMENT TO LEAVE ON THE PROJECT PAGE AFTER SUBMITTING
==============================================================

@Alex_Fhenix Wave 3: integrated ConfidentialToken (FHERC20) per your Wave 2 feedback. Lender deposits, payouts, refunds now flow through encrypted balances. Commits bfef53a + 39ef564. Wave-3 writeup: https://github.com/Leihyn/blindbond/blob/main/WAVE3_UPDATE.md
