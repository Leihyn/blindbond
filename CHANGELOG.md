# Changelog

Wave-by-wave progress for the Fhenix Private-By-Design Buildathon.

---

## Wave 3 — 2026-05-04

**Theme:** Encrypted positions, not just encrypted bids.

Wave 2 judge feedback (Alex_Fhenix): *"Nice concept, try to work with confidential tokens for next waves."* This wave delivers exactly that.

### Added
- **`contracts/ConfidentialToken.sol`** — full FHERC20 implementation. Balances are `euint64`, transfers happen on ciphertext, and approvals use an operator model instead of ERC20 allowances (which would leak balance information through gas patterns).
- **End-to-end encrypted lender lifecycle.** Deposits, refunds, payouts, and repayment all flow through `ConfidentialToken`. An on-chain observer sees ciphertext hashes, not dollar amounts. Rates *and* positions are now private.
- **`scripts/seed-bond.ts`** — one-command judge walkthrough: seeds a bond with five encrypted bids on Arbitrum Sepolia.
- **`scripts/publish-and-settle.ts`** — drives the resolve → publish → settle path against live FHE.
- **`scripts/full-demo.ts` rewrite** — full lifecycle (create → bid × 5 → resolve K passes → publish → settle → repay → claim) in a single command.
- **Frontend rebuild** — bond lifecycle UI in `frontend/src/App.tsx` + `App.css`, `BondAuction.ts` ABI helpers, Vite asset pipeline (favicon, hero, icons), `vercel.json` for deployment.
- **`DEMO-SCRIPT.md`** — narrated walkthrough for the demo video.

### Changed
- **`BondAuction.sol`** — `createBond` now accepts a `ConfidentialToken` for the borrow asset; `submitRate`, `settle`, `repay`, `claim`, and `claimRefund` all transact through encrypted balances. Refund issuance creates a per-bid `euint64` so each ACL grant is scoped.
- **`test/BondAuction.ts`** — full suite migrated to the FHERC20 path; lender setup uses `setOperator(auction, expiry)` instead of ERC20 `approve`. Refund assertions check `balanceIndicator` deltas (clients re-unseal on bump).
- **Deploy scripts** — sequential deploy now plumbs the `ConfidentialToken` address through to the auction and the frontend `addresses.json`.

### Notes for judges
- Verify the FHERC20 path: `npx hardhat test test/ConfidentialTokenFlows.ts`
- Live walkthrough: `npx hardhat run scripts/seed-bond.ts --network arb-sepolia`
- All commits since Wave 2: `git log 5060bab..HEAD`

---

## Wave 2 — 2026-04-06

**Theme:** From sealed-bid theory to a working bond auction.

### Added
- Iterated tournament resolution (`resolvePass`) — K passes find the K-th lowest encrypted rate using `FHE.lt` and `FHE.select`, no decryption per-pass.
- Uniform-price settlement — every winner earns the marginal winner's actual bid (not Vickrey, not utilization-curve).
- 17 passing tests covering creation, bidding, close, resolution, settlement, refunds, repayment, liquidation, and compliance disclosure.
- Live deployment on Arbitrum Sepolia with real client-side TFHE-WASM encryption.

### Score
- Judge: **Alex_Fhenix** — 6/8/7/6/8 (35/50)
- Grant: 0 USDC
- Feedback addressed in Wave 3: confidential token integration.

---

## Wave 1 — 2026-03-28

**Theme:** Concept, contract skeleton, and the encryption pipeline.

### Added
- Initial `BondAuction.sol` with create/bid/close/resolve scaffolding.
- TFHE-WASM browser encryption for rate inputs.
- `MockERC20` collateral path.
- README pitch tying the work to the $2T sealed-bid Treasury auction precedent.
