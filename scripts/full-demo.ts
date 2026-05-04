import hre from "hardhat";
import { createCofheClient, createCofheConfig } from "@cofhe/sdk/node";
import { Encryptable } from "@cofhe/sdk";
import { arbSepolia } from "@cofhe/sdk/chains";
import { createPublicClient, createWalletClient, http } from "viem";
import { arbitrumSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

const ADDRESSES = {
  BondAuction: "0x2f62CcF1C2589c9f785Ea861CF7E16FF1f61F90E",
  cUSDC: "0x443Cf954feFd48ac73f1bC79C71978D427e93389",
  WETH: "0x39D746e76631E81F50E8a013b509eB716981f9C0",
};

const RPC_URL = process.env.ARBITRUM_SEPOLIA_RPC_URL || "https://sepolia-rollup.arbitrum.io/rpc";
const DEPLOYER_PK = process.env.PRIVATE_KEY as `0x${string}`;

// Bond params — small for demo
const SLOT_SIZE = 100n * 10n ** 6n; // 100 cUSDC per slot (uint64 with 6 decimals)
const SLOT_COUNT = 2n;
const MAX_RATE = 2000n; // 20%
const DURATION = 300n; // 5 min (short for demo)
const BIDDING_DURATION = 360n; // 6 minutes (FHE encryption takes time)
const MIN_BIDDERS = 3n;
const COLLATERAL = hre.ethers.parseUnits("0.1", 18); // 0.1 WETH

// Operator expiry: far future (~2033)
const OPERATOR_UNTIL = 2000000000;

// Lender rates in bps
const LENDER_RATES = [300n, 450n, 380n]; // 3%, 4.5%, 3.8%
// Sorted: 300, 380, 450 → K=2 winners: 300, 380 → clearing rate = 380 (3.80%)

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const deployer = (await hre.ethers.getSigners())[0];
  const auction = await hre.ethers.getContractAt("BondAuction", ADDRESSES.BondAuction);
  const cusdc = await hre.ethers.getContractAt("ConfidentialToken", ADDRESSES.cUSDC);
  const weth = await hre.ethers.getContractAt("MockERC20", ADDRESSES.WETH);

  const publicClient = createPublicClient({
    chain: arbitrumSepolia,
    transport: http(RPC_URL),
  });

  console.log("Deployer:", deployer.address);
  console.log("");

  // ============================================================
  // STEP 1: Mint tokens to deployer
  // ============================================================
  console.log("=== STEP 1: Mint tokens ===");
  let tx = await weth.mint(deployer.address, COLLATERAL);
  await tx.wait();
  // Mint cUSDC (ConfidentialToken) — balance stored encrypted
  tx = await cusdc.mint(deployer.address, Number(SLOT_SIZE) * 10); // extra for repayment later
  await tx.wait();
  console.log("Minted 0.1 WETH + 1000 cUSDC (encrypted balance) to deployer\n");

  // ============================================================
  // STEP 2: Create bond (deployer = borrower)
  // ============================================================
  console.log("=== STEP 2: Create bond ===");
  tx = await weth.approve(ADDRESSES.BondAuction, COLLATERAL);
  await tx.wait();

  tx = await auction.createBond(
    ADDRESSES.WETH, COLLATERAL,
    ADDRESSES.cUSDC, SLOT_SIZE, SLOT_COUNT,
    MAX_RATE, DURATION, BIDDING_DURATION, MIN_BIDDERS
  );
  const createReceipt = await tx.wait();
  const bondId = (await auction.nextBondId()) - 1n;
  console.log("Bond ID:", bondId.toString());
  console.log("Tx:", createReceipt?.hash);

  const bondData = await auction.getBond(bondId);
  const deadline = Number(bondData[8]);
  console.log("Bidding deadline:", new Date(deadline * 1000).toLocaleTimeString());
  console.log("Slots:", SLOT_COUNT.toString(), "x", hre.ethers.formatUnits(SLOT_SIZE, 6), "cUSDC");
  console.log("Max rate:", (Number(MAX_RATE) / 100).toFixed(2) + "%");
  console.log("Borrow token: ConfidentialToken (FHERC20) — encrypted balances");
  console.log("");

  // ============================================================
  // STEP 3: Create lender wallets, fund them, submit encrypted bids
  // ============================================================
  console.log("=== STEP 3: Submit encrypted rate bids ===");

  const lenders: any[] = [];
  for (let i = 0; i < LENDER_RATES.length; i++) {
    const rate = LENDER_RATES[i];
    const wallet = hre.ethers.Wallet.createRandom().connect(deployer.provider);
    console.log(`\nLender ${i + 1}: ${wallet.address}`);
    console.log(`  Rate: ${(Number(rate) / 100).toFixed(2)}% (${rate} bps) — ENCRYPTED, nobody can see this`);

    // Fund with ETH for gas
    tx = await deployer.sendTransaction({ to: wallet.address, value: hre.ethers.parseEther("0.0005") });
    await tx.wait();
    console.log("  Funded with 0.003 ETH");

    // Mint cUSDC (encrypted balance)
    tx = await cusdc.mint(wallet.address, Number(SLOT_SIZE));
    await tx.wait();
    console.log("  Minted", hre.ethers.formatUnits(SLOT_SIZE, 6), "cUSDC (encrypted balance)");

    // Create CoFHE client for this lender
    const lenderViemWallet = createWalletClient({
      account: privateKeyToAccount(wallet.privateKey as `0x${string}`),
      chain: arbitrumSepolia,
      transport: http(RPC_URL),
    });

    const cofhe = createCofheClient(createCofheConfig({ supportedChains: [arbSepolia] }));
    await cofhe.connect(publicClient, lenderViemWallet);

    // Encrypt rate
    console.log("  Encrypting rate with FHE...");
    const [encryptedRate] = await cofhe.encryptInputs([Encryptable.uint64(rate)]).execute();
    console.log("  Encrypted! ctHash:", encryptedRate.ctHash?.toString()?.slice(0, 16) + "...");

    // Set operator on ConfidentialToken (replaces ERC20 approve)
    const lenderCusdc = cusdc.connect(wallet) as typeof cusdc;
    tx = await lenderCusdc.setOperator(ADDRESSES.BondAuction, OPERATOR_UNTIL);
    await tx.wait();
    console.log("  Operator set on cUSDC (ConfidentialToken)");

    const lenderAuction = auction.connect(wallet) as typeof auction;
    tx = await lenderAuction.submitRate(bondId, encryptedRate);
    const bidReceipt = await tx.wait();
    console.log("  Bid submitted! Gas:", bidReceipt?.gasUsed?.toString());
    console.log("  Deposit transferred via encrypted balance — amount private on-chain");

    lenders.push({ wallet, rate });
  }

  const bidCount = await auction.getBidCount(bondId);
  console.log("\nTotal bids:", bidCount.toString());

  // ============================================================
  // STEP 4: Wait for bidding deadline, then close
  // ============================================================
  console.log("\n=== STEP 4: Wait for deadline + close ===");
  const now = Math.floor(Date.now() / 1000);
  const waitSeconds = deadline - now + 5; // 5 sec buffer
  if (waitSeconds > 0) {
    console.log(`Waiting ${waitSeconds} seconds for deadline...`);
    await sleep(waitSeconds * 1000);
  }

  tx = await auction.closeBond(bondId);
  await tx.wait();
  console.log("Bond closed!");

  // ============================================================
  // STEP 5: Resolve passes (K=2)
  // ============================================================
  console.log("\n=== STEP 5: Resolve tournament passes ===");
  for (let pass = 0; pass < Number(SLOT_COUNT); pass++) {
    console.log(`\nResolving pass ${pass + 1}/${SLOT_COUNT}...`);
    tx = await auction.resolvePass(bondId);
    const resolveReceipt = await tx.wait();
    console.log(`  Pass ${pass + 1} complete! Gas:`, resolveReceipt?.gasUsed?.toString());

    const bondState = await auction.getBond(bondId);
    const stateNames = ["Open", "Closed", "Resolving", "Resolved", "Active", "Repaid", "Defaulted", "Cancelled"];
    console.log("  State:", stateNames[Number(bondState[10])]);
  }

  // ============================================================
  // STEP 6: Settle
  // ============================================================
  console.log("\n=== STEP 6: Settle bond ===");

  // Publish decryption results via CoFHE SDK
  console.log("Fetching decryption results from CoFHE threshold network...");
  await sleep(5000);

  // Get clearing rate handle from raw bond storage
  const rawBond = await auction.bonds(bondId);
  const clearingRateHandle = rawBond[14]; // euint64 clearingRate

  // Decrypt clearing rate
  const cofheDeployer = createCofheClient(createCofheConfig({ supportedChains: [arbSepolia] }));
  const deployerViemWallet = createWalletClient({
    account: privateKeyToAccount(DEPLOYER_PK),
    chain: arbitrumSepolia,
    transport: http(RPC_URL),
  });
  await cofheDeployer.connect(publicClient, deployerViemWallet);

  console.log("Decrypting clearing rate...");
  const rateResult = await cofheDeployer.decryptForTx(BigInt(clearingRateHandle)).withoutPermit().execute();
  console.log("Clearing rate:", (Number(rateResult.decryptedValue) / 100).toFixed(2) + "%");

  // Decrypt winner flags from storage
  console.log("Decrypting winner flags...");
  const winnerFlags: boolean[] = [];
  const flagSignatures: string[] = [];
  const n = Number(await auction.getBidCount(bondId));

  for (let i = 0; i < n; i++) {
    const bondSlot = hre.ethers.keccak256(
      hre.ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "uint256"], [bondId, 4])
    );
    const arrayStart = hre.ethers.keccak256(bondSlot);
    const elementSlot = BigInt(arrayStart) + BigInt(i);
    const flagHandle = await deployer.provider.getStorage(
      ADDRESSES.BondAuction,
      "0x" + elementSlot.toString(16).padStart(64, "0")
    );
    const flagResult = await cofheDeployer.decryptForTx(BigInt(flagHandle)).withoutPermit().execute();
    winnerFlags.push(flagResult.decryptedValue > 0n);
    flagSignatures.push(flagResult.signature);
    console.log(`  Bid ${i}: ${flagResult.decryptedValue > 0n ? "WINNER" : "loser"}`);
  }

  // Publish on-chain
  console.log("Publishing decryption results on-chain...");
  tx = await auction.publishResults(
    bondId, rateResult.decryptedValue, rateResult.signature, winnerFlags, flagSignatures
  );
  await tx.wait();
  console.log("Results published!");

  // Settle
  tx = await auction.settle(bondId);
  const settleReceipt = await tx.wait();
  console.log("Bond settled! Gas:", settleReceipt?.gasUsed?.toString());

  const settledBond = await auction.getBond(bondId);
  const clearingRate = Number(settledBond[13]);
  const totalRepayment = settledBond[14];
  console.log(`\n  CLEARING RATE: ${(clearingRate / 100).toFixed(2)}%`);
  console.log(`  Total repayment: ${hre.ethers.formatUnits(totalRepayment, 6)} cUSDC`);
  console.log(`  Principal: ${hre.ethers.formatUnits(SLOT_SIZE * SLOT_COUNT, 6)} cUSDC`);
  console.log(`  Interest: ${hre.ethers.formatUnits(totalRepayment - SLOT_SIZE * SLOT_COUNT, 6)} cUSDC`);

  const winners = await auction.getWinners(bondId);
  console.log(`  Winners (${winners.length}):`);
  for (const w of winners) {
    const lender = lenders.find((l) => l.wallet.address.toLowerCase() === w.toLowerCase());
    console.log(`    ${w.slice(0, 10)}... — bid ${lender ? (Number(lender.rate) / 100).toFixed(2) + "%" : "unknown"} (earns ${(clearingRate / 100).toFixed(2)}%)`);
  }

  // Losers refunded via ConfidentialToken (encrypted)
  console.log("  Losers refunded via encrypted transfer (balance private on-chain)");

  // ============================================================
  // STEP 7: Borrower repays
  // ============================================================
  console.log("\n=== STEP 7: Borrower repays ===");
  // Set operator for repayment
  tx = await cusdc.setOperator(ADDRESSES.BondAuction, OPERATOR_UNTIL);
  await tx.wait();
  tx = await auction.repay(bondId);
  const repayReceipt = await tx.wait();
  console.log("Repaid!", hre.ethers.formatUnits(totalRepayment, 6), "cUSDC (encrypted transfer)");
  console.log("Collateral returned to borrower (standard ERC20)");

  // ============================================================
  // STEP 8: Lenders claim
  // ============================================================
  console.log("\n=== STEP 8: Lenders claim payouts ===");
  for (const w of winners) {
    const lender = lenders.find((l) => l.wallet.address.toLowerCase() === w.toLowerCase());
    if (lender) {
      const lenderAuction = auction.connect(lender.wallet) as typeof auction;
      tx = await lenderAuction.claim(bondId);
      await tx.wait();
      console.log(`  ${w.slice(0, 10)}... claimed payout (encrypted balance — amount private on-chain)`);
    }
  }

  // ============================================================
  // DONE
  // ============================================================
  console.log("\n========================================");
  console.log("FULL LIFECYCLE COMPLETE ON ARBITRUM SEPOLIA");
  console.log("========================================");
  console.log(`Bond ID: ${bondId}`);
  console.log(`Borrow token: ConfidentialToken (FHERC20) — all deposits, payouts, refunds use encrypted balances`);
  console.log(`Lender rates: ${LENDER_RATES.map((r) => (Number(r) / 100).toFixed(2) + "%").join(", ")} (all encrypted, never revealed)`);
  console.log(`Clearing rate: ${(clearingRate / 100).toFixed(2)}% (marginal winner's rate)`);
  console.log(`Winners earned: ${(clearingRate / 100).toFixed(2)}% (uniform price — not their own bid)`);
  console.log(`Losers: fully refunded (encrypted transfer)`);
  console.log(`Borrower: repaid principal + interest, got collateral back`);
  console.log(`\nPrivacy: Rate bids AND token balances are encrypted on-chain.`);
  console.log(`An observer sees encrypted ciphertext for both rates and amounts.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
