import hre from "hardhat";
import { createCofheClient, createCofheConfig } from "@cofhe/sdk/node";
import { Encryptable } from "@cofhe/sdk";
import { arbSepolia } from "@cofhe/sdk/chains";
import { createPublicClient, createWalletClient, http } from "viem";
import { arbitrumSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

/**
 * Seed a bond with bids for judges to explore.
 *
 * Creates a bond with 3 slots, funds 5 lender wallets, encrypts and submits
 * 5 rate bids, then waits for deadline and closes. The bond is left in
 * Closed state — judges can step through resolvePass, settle, repay, and
 * claim in the UI to see the full lifecycle.
 *
 * Usage: npx hardhat run scripts/seed-bond.ts --network arb-sepolia
 */

const RPC_URL = process.env.ARBITRUM_SEPOLIA_RPC_URL || "https://sepolia-rollup.arbitrum.io/rpc";

// Will be updated after deployment — or read from addresses.json
let ADDRESSES: any;
try {
  ADDRESSES = require("../frontend/src/addresses.json");
} catch {
  ADDRESSES = {
    BondAuction: "0xD916970FE36541A0a71Db13415CfFBFF005e761e",
    cUSDC: "0xcC86944f5E7385cA6Df8EEC5d40957840cfdfbb2",
    WETH: "0x55Bd48C34441FEdA5c0D45a2400976fB933Abb7e",
  };
}

const SLOT_SIZE = 500n * 10n ** 6n; // 500 cUSDC per slot
const SLOT_COUNT = 3n;
const MAX_RATE = 1500n; // 15%
const DURATION = 7n * 24n * 60n * 60n; // 7 days
const BIDDING_DURATION = 300n; // 5 min bidding window (short for seed)
const MIN_BIDDERS = 4n;
const COLLATERAL = hre.ethers.parseUnits("0.5", 18);
const OPERATOR_UNTIL = 2000000000;

// 5 lender rates in bps — diverse spread
const LENDER_RATES = [350n, 500n, 420n, 800n, 375n];
// Sorted: 350, 375, 420, 500, 800
// K=3 → Winners: 350, 375, 420 → Clearing rate = 420 (4.20%)

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const deployer = (await hre.ethers.getSigners())[0];
  const auctionAddr = ADDRESSES.BondAuction || ADDRESSES.bondAuction;
  const cusdcAddr = ADDRESSES.cUSDC || ADDRESSES.cusdc;
  const wethAddr = ADDRESSES.WETH || ADDRESSES.weth;

  const auction = await hre.ethers.getContractAt("BondAuction", auctionAddr);
  const cusdc = await hre.ethers.getContractAt("ConfidentialToken", cusdcAddr);
  const weth = await hre.ethers.getContractAt("MockERC20", wethAddr);

  const publicClient = createPublicClient({
    chain: arbitrumSepolia,
    transport: http(RPC_URL),
  });

  console.log("Deployer:", deployer.address);
  console.log("Seeding a bond for judges to explore...\n");

  // Mint tokens
  console.log("Minting tokens...");
  let tx = await weth.mint(deployer.address, COLLATERAL);
  await tx.wait();
  tx = await cusdc.mint(deployer.address, Number(SLOT_SIZE * 20n)); // plenty for repayment
  await tx.wait();

  // Create bond
  console.log("Creating bond...");
  tx = await weth.approve(auctionAddr, COLLATERAL);
  await tx.wait();

  tx = await auction.createBond(
    wethAddr, COLLATERAL,
    cusdcAddr, SLOT_SIZE, SLOT_COUNT,
    MAX_RATE, DURATION, BIDDING_DURATION, MIN_BIDDERS
  );
  await tx.wait();
  const bondId = (await auction.nextBondId()) - 1n;
  console.log(`Bond #${bondId} created`);
  console.log(`  ${SLOT_COUNT} slots x ${hre.ethers.formatUnits(SLOT_SIZE, 6)} cUSDC`);
  console.log(`  Max rate: ${(Number(MAX_RATE) / 100).toFixed(2)}%`);

  // Submit bids from fresh wallets
  console.log("\nSubmitting encrypted bids...");
  for (let i = 0; i < LENDER_RATES.length; i++) {
    const rate = LENDER_RATES[i];
    const wallet = hre.ethers.Wallet.createRandom().connect(deployer.provider);

    // Fund
    tx = await deployer.sendTransaction({ to: wallet.address, value: hre.ethers.parseEther("0.0005") });
    await tx.wait();
    tx = await cusdc.mint(wallet.address, Number(SLOT_SIZE));
    await tx.wait();

    // CoFHE encrypt
    const lenderViemWallet = createWalletClient({
      account: privateKeyToAccount(wallet.privateKey as `0x${string}`),
      chain: arbitrumSepolia,
      transport: http(RPC_URL),
    });
    const cofhe = createCofheClient(createCofheConfig({ supportedChains: [arbSepolia] }));
    await cofhe.connect(publicClient, lenderViemWallet);
    const [encryptedRate] = await cofhe.encryptInputs([Encryptable.uint64(rate)]).execute();

    // Set operator + submit
    const lenderCusdc = cusdc.connect(wallet) as typeof cusdc;
    tx = await lenderCusdc.setOperator(auctionAddr, OPERATOR_UNTIL);
    await tx.wait();
    const lenderAuction = auction.connect(wallet) as typeof auction;
    tx = await lenderAuction.submitRate(bondId, encryptedRate);
    await tx.wait();

    console.log(`  Lender ${i + 1}: ${(Number(rate) / 100).toFixed(2)}% (encrypted)`);
  }

  // Wait for deadline + close
  const bondData = await auction.getBond(bondId);
  const deadline = Number(bondData[8]);
  const now = Math.floor(Date.now() / 1000);
  const wait = deadline - now + 5;
  if (wait > 0) {
    console.log(`\nWaiting ${wait}s for bidding deadline...`);
    await sleep(wait * 1000);
  }

  tx = await auction.closeBond(bondId);
  await tx.wait();
  console.log("Bond closed!");

  console.log("\n========================================");
  console.log(`SEED COMPLETE — Bond #${bondId}`);
  console.log("========================================");
  console.log("State: Closed (ready for resolution)");
  console.log("Judges can now:");
  console.log("  1. Open the app and navigate to Bond #" + bondId);
  console.log("  2. Click 'Resolve Pass' 3 times (one per slot)");
  console.log("  3. Wait ~15s for CoFHE decryption");
  console.log("  4. Click 'Settle Bond' to see clearing rate");
  console.log("  5. Expected clearing rate: 4.20% (420 bps)");
  console.log(`\nAll bids and deposits use ConfidentialToken (FHERC20)`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
