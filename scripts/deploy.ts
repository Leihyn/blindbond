import hre from "hardhat";

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying with:", deployer.address);
  console.log("Network:", hre.network.name);

  // Deploy ConfidentialToken (FHERC20) for borrow token — encrypted balances
  const ConfidentialToken = await hre.ethers.getContractFactory("ConfidentialToken");
  const cusdc = await ConfidentialToken.deploy("Confidential USD Coin", "cUSDC", 6);
  await cusdc.waitForDeployment();
  console.log("cUSDC (ConfidentialToken) deployed:", await cusdc.getAddress());

  // Deploy standard ERC20 for collateral (public amounts for liquidation math)
  const MockERC20 = await hre.ethers.getContractFactory("MockERC20");
  const weth = await MockERC20.deploy("Wrapped Ether", "WETH", 18);
  await weth.waitForDeployment();
  console.log("WETH deployed:", await weth.getAddress());

  // Deploy BondAuction
  const BondAuction = await hre.ethers.getContractFactory("BondAuction");
  const auction = await BondAuction.deploy();
  await auction.waitForDeployment();
  console.log("BondAuction deployed:", await auction.getAddress());

  // Write addresses for frontend
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

  fs.writeFileSync(
    path.join(outDir, "addresses.json"),
    JSON.stringify(addresses, null, 2)
  );

  console.log("\nAddresses written to frontend/src/addresses.json");
  console.log(JSON.stringify(addresses, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
