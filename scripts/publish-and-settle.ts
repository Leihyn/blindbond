import hre from "hardhat";
import { createCofheClient, createCofheConfig } from "@cofhe/sdk/node";
import { arbSepolia } from "@cofhe/sdk/chains";
import { createPublicClient, createWalletClient, http } from "viem";
import { arbitrumSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

/**
 * Publish CoFHE decryption results and settle a resolved bond.
 *
 * On live testnet, FHE.decrypt() submits a request to the threshold network.
 * The results need to be published on-chain via publishResults() before
 * settle() can read them.
 *
 * This script:
 * 1. Reads the clearing rate handle from the bond
 * 2. Reads the excluded flag handles for each bid
 * 3. Uses cofhe SDK decryptForTx to get plaintext + signatures
 * 4. Calls publishResults() to publish on-chain
 * 5. Calls settle()
 */

const ADDRESSES = {
  BondAuction: "0x2f62CcF1C2589c9f785Ea861CF7E16FF1f61F90E",
  cUSDC: "0x443Cf954feFd48ac73f1bC79C71978D427e93389",
  WETH: "0x39D746e76631E81F50E8a013b509eB716981f9C0",
};

const RPC_URL = process.env.ARBITRUM_SEPOLIA_RPC_URL || "https://sepolia-rollup.arbitrum.io/rpc";
const BOND_ID = 0n;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const deployer = (await hre.ethers.getSigners())[0];
  const auction = await hre.ethers.getContractAt("BondAuction", ADDRESSES.BondAuction);

  console.log("Publishing decryption results for Bond #" + BOND_ID);

  // Check bond state
  const bond = await auction.getBond(BOND_ID);
  const state = Number(bond[10]);
  if (state !== 3) {
    console.log("Bond is not in Resolved state (state=" + state + "). Cannot publish.");
    return;
  }

  // Get bid count
  const bidCount = Number(await auction.getBidCount(BOND_ID));
  console.log("Bid count:", bidCount);

  // Read the raw bond storage to get the clearing rate handle
  const rawBond = await auction.bonds(BOND_ID);
  const clearingRateHandle = rawBond[14]; // euint64 clearingRate in struct
  console.log("Clearing rate handle:", clearingRateHandle.toString().slice(0, 20) + "...");

  // Connect CoFHE SDK
  const pk = process.env.PRIVATE_KEY as `0x${string}`;
  const publicClient = createPublicClient({
    chain: arbitrumSepolia,
    transport: http(RPC_URL),
  });
  const walletClient = createWalletClient({
    account: privateKeyToAccount(pk),
    chain: arbitrumSepolia,
    transport: http(RPC_URL),
  });

  const cofhe = createCofheClient(createCofheConfig({ supportedChains: [arbSepolia] }));
  await cofhe.connect(publicClient, walletClient);
  console.log("CoFHE SDK connected\n");

  // Decrypt clearing rate
  console.log("Decrypting clearing rate...");
  let rateResult: any;
  try {
    rateResult = await cofhe.decryptForTx(BigInt(clearingRateHandle)).withoutPermit().execute();
    console.log("Clearing rate decrypted:", rateResult.decryptedValue.toString(), "bps =",
      (Number(rateResult.decryptedValue) / 100).toFixed(2) + "%");
  } catch (e: any) {
    console.error("Failed to decrypt clearing rate:", e.message?.slice(0, 200));
    console.log("\nThe threshold network may not have processed the decrypt request yet.");
    console.log("Try again in a few minutes.");
    return;
  }

  // Decrypt winner flags (excluded[] array)
  console.log("\nDecrypting winner flags...");
  const winnerFlags: boolean[] = [];
  const flagSignatures: string[] = [];

  for (let i = 0; i < bidCount; i++) {
    try {
      // Read the excluded flag handle — need to access internal storage
      // excluded[bondId][i] is stored in a nested mapping
      // We need a getter for this... let's use the contract's internal state

      // Actually, excluded is internal, so we can't read it directly.
      // We need to compute the storage slot manually.
      const bondSlot = hre.ethers.keccak256(
        hre.ethers.AbiCoder.defaultAbiCoder().encode(
          ["uint256", "uint256"],
          [BOND_ID, 4] // excluded mapping is at storage slot 4 (after nextBondId=0, bonds=1, bids=2, hasBid=3)
        )
      );

      // excluded[bondId] is a dynamic array, its length is at bondSlot
      // elements start at keccak256(bondSlot)
      const arrayStart = hre.ethers.keccak256(bondSlot);
      const elementSlot = BigInt(arrayStart) + BigInt(i);

      const flagHandle = await deployer.provider.getStorage(
        ADDRESSES.BondAuction,
        "0x" + elementSlot.toString(16).padStart(64, "0")
      );

      console.log(`  Flag ${i} handle:`, flagHandle.slice(0, 20) + "...");

      const flagResult = await cofhe.decryptForTx(BigInt(flagHandle)).withoutPermit().execute();
      winnerFlags.push(flagResult.decryptedValue > 0n);
      flagSignatures.push(flagResult.signature);
      console.log(`  Flag ${i}: ${flagResult.decryptedValue > 0n ? "WINNER" : "not winner"}`);
    } catch (e: any) {
      console.error(`  Failed to decrypt flag ${i}:`, e.message?.slice(0, 100));
      return;
    }
  }

  // Call publishResults
  console.log("\nPublishing results on-chain...");
  try {
    const tx = await auction.publishResults(
      BOND_ID,
      rateResult.decryptedValue,
      rateResult.signature,
      winnerFlags,
      flagSignatures
    );
    const receipt = await tx.wait();
    console.log("Results published! Gas:", receipt?.gasUsed?.toString());
  } catch (e: any) {
    console.error("publishResults failed:", e.message?.slice(0, 200));
    return;
  }

  // Now settle
  console.log("\nSettling bond...");
  try {
    const tx = await auction.settle(BOND_ID);
    const receipt = await tx.wait();
    console.log("SETTLED! Gas:", receipt?.gasUsed?.toString());

    const settled = await auction.getBond(BOND_ID);
    console.log("\nClearing rate:", Number(settled[13]) / 100 + "%");
    console.log("Total repayment:", hre.ethers.formatUnits(settled[14], 6), "cUSDC");

    const winners = await auction.getWinners(BOND_ID);
    console.log("Winners:", winners);
  } catch (e: any) {
    console.error("settle failed:", e.message?.slice(0, 200));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
