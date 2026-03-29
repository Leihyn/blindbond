import hre from "hardhat";

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying with:", deployer.address);
  console.log("Network:", hre.network.name);

  // Deploy MockERC20s (for testnet demo)
  const MockERC20 = await hre.ethers.getContractFactory("MockERC20");

  const usdc = await MockERC20.deploy("USD Coin", "USDC", 6);
  await usdc.waitForDeployment();
  console.log("USDC deployed:", await usdc.getAddress());

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
    USDC: await usdc.getAddress(),
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
