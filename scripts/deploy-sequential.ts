import hre from "hardhat";

async function deployWithRetry(name: string, args: any[], retries = 3): Promise<any> {
  const Factory = await hre.ethers.getContractFactory(name);
  for (let i = 0; i < retries; i++) {
    try {
      const contract = await Factory.deploy(...args);
      await contract.waitForDeployment();
      const addr = await contract.getAddress();
      console.log(`${name} deployed: ${addr}`);
      return contract;
    } catch (e: any) {
      console.log(`${name} attempt ${i + 1} failed: ${e.message?.slice(0, 80)}`);
      if (i === retries - 1) throw e;
      await new Promise(r => setTimeout(r, 3000));
    }
  }
}

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying with:", deployer.address);
  console.log("Network:", hre.network.name);

  // ConfidentialToken (FHERC20) for borrow token — encrypted balances
  const cusdc = await deployWithRetry("ConfidentialToken", ["Confidential USD Coin", "cUSDC", 6]);
  await new Promise(r => setTimeout(r, 2000));

  // Standard ERC20 for collateral (public amounts)
  const weth = await deployWithRetry("MockERC20", ["Wrapped Ether", "WETH", 18]);
  await new Promise(r => setTimeout(r, 2000));

  const auction = await deployWithRetry("BondAuction", []);

  const addresses = {
    network: hre.network.name,
    chainId: hre.network.config.chainId,
    deployer: deployer.address,
    BondAuction: await auction.getAddress(),
    cUSDC: await cusdc.getAddress(),
    WETH: await weth.getAddress(),
  };

  const fs = await import("fs");
  const path = await import("path");
  const outDir = path.join(__dirname, "..", "frontend", "src");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "addresses.json"), JSON.stringify(addresses, null, 2));

  console.log("\nDeployment complete!");
  console.log(JSON.stringify(addresses, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
