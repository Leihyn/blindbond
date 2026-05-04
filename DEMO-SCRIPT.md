# BlindBond Demo Script

## Before Recording

- [ ] Deploy fresh contracts: `npx hardhat run scripts/deploy-sequential.ts --network arb-sepolia`
- [ ] Seed a bond: `npx hardhat run scripts/seed-bond.ts --network arb-sepolia`
- [ ] Open https://blindbond.vercel.app in a clean browser
- [ ] Connect MetaMask (Arbitrum Sepolia)
- [ ] Have terminal ready for `full-demo.ts` output

## The Hook (15 sec)

> "The US Treasury issues $2 trillion in bonds every year through sealed-bid auctions. That mechanism doesn't exist on-chain because sealed bid on a transparent blockchain is an oxymoron."
>
> "DeFi lending rates are set by formulas, not markets. Institutional lenders won't participate because their bidding strategies leak on-chain."

**[Do: Show the landing page with stats]**

## The Core Mechanism (30 sec)

> "BlindBond fixes this with Fully Homomorphic Encryption. Lenders encrypt their interest rate bids client-side. The smart contract finds the clearing rate by computing directly on ciphertext — without decrypting any individual bid."

**[Do: Scroll to How It Works section, pause on each step]**

> "And now in this version, all lending flows use Confidential Tokens — an FHERC20 implementation where balances are encrypted on-chain. Not just rates — the actual token positions are private."

## Live Demo (2 min)

### Create Bond

**[Do: Click Borrow tab]**

> "A borrower posts collateral and requests a loan. Collateral stays as standard ERC20 because liquidation math needs public amounts. But the borrow token — that's a ConfidentialToken."

**[Do: Show the pre-seeded bond in Bonds tab instead]**

### Encrypted Bidding

**[Do: Click Lend tab, select the seeded bond]**

> "Watch what happens when a lender submits a bid. The rate is encrypted in-browser using TFHE WASM. The ciphertext goes on-chain. The plaintext never leaves your device."

**[Do: Click 'Authorize cUSDC', then 'Encrypt & Submit Bid']**

This is the money shot. Let the encryption overlay animation play fully.

> "That deposit just flowed through ConfidentialToken. The balance transfer is encrypted — an observer on Arbiscan sees a ciphertext hash, not a dollar amount."

### Tournament Resolution

**[Do: Navigate to the seeded bond in Bonds tab]**

> "Now the tournament. Each pass finds one winner through FHE comparisons — encrypted less-than, encrypted select, encrypted equality — seven FHE operations per bid per pass."

**[Do: Click 'Resolve Pass' — show the tournament visualization updating]**

> "No decryption. No reveal phase. The contract is computing on ciphertext."

**[Do: Click 'Resolve Pass' two more times]**

### Settlement

**[Do: Wait ~15s, then click 'Settle Bond']**

> "The clearing rate: 4.20%. All winning lenders earn this same rate. Individual bids stay encrypted forever. Losing bids? Also encrypted forever."

**[Do: Point to the clearing rate hero display]**

## The Close (15 sec)

> "BlindBond: encrypted rate discovery with confidential token flows. Rates are encrypted. Balances are encrypted. Built on Fhenix CoFHE. 17 passing tests. Live on Arbitrum Sepolia."
>
> "DeFi finally gets real price discovery."

## If Things Go Wrong

**Settle reverts with "not decrypted yet"**
Wait 15 more seconds. CoFHE threshold decryption takes 10-15s after the final resolve pass.

**Encryption overlay hangs**
The CoFHE SDK needs to download TFHE WASM (~2MB). First load is slow. Refresh and retry.

**Transaction reverts with no error**
Check ETH balance for gas. Mint from the testnet faucet.
