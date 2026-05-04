/// Wave 3 — dedicated FHERC20 flow tests.
///
/// These exercise the ConfidentialToken paths that BlindBond depends on,
/// independent of the auction logic, so the encrypted-balance behavior is
/// verifiable on its own. They also document the operator model that
/// replaces ERC20 allowances.

const hre = require("hardhat");
const { expect } = require("chai");
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ConfidentialToken } from "../typechain-types";
const { Encryptable, FheTypes } = require("@cofhe/sdk");

const DECIMALS = 6;
const ONE = 1_000_000n;            // 1.000000 cUSDC
const SLOT = 10_000n * ONE;        // 10,000 cUSDC
const FAR_FUTURE = 2_000_000_000;  // ~2033

describe("ConfidentialToken (FHERC20) flows", function () {
  let cusdc: ConfidentialToken;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;
  let auction: HardhatEthersSigner; // simulated operator (acts like BondAuction)

  async function clientFor(signer: HardhatEthersSigner) {
    return await hre.cofhe.createClientWithBatteries(signer);
  }

  async function unseal(signer: HardhatEthersSigner, handle: bigint | string): Promise<bigint> {
    const client = await clientFor(signer);
    const [value] = await client.unseal([{ handle: BigInt(handle), utype: FheTypes.Uint64 }]).execute();
    return BigInt(value);
  }

  beforeEach(async function () {
    [alice, bob, auction] = await hre.ethers.getSigners();
    const Factory = await hre.ethers.getContractFactory("ConfidentialToken");
    cusdc = await Factory.deploy("Confidential USD Coin", "cUSDC", DECIMALS);
  });

  it("encrypts deposits — balanceIndicator bumps and unsealed value matches mint", async function () {
    expect(await cusdc.balanceIndicator(alice.address)).to.equal(0n);

    await cusdc.mint(alice.address, Number(SLOT));

    // Public surface only exposes a nonce-style indicator; the amount itself is encrypted.
    expect(await cusdc.balanceIndicator(alice.address)).to.equal(1n);
    expect(await cusdc.totalMinted()).to.equal(SLOT);

    // The holder (and only the holder) can unseal their balance.
    const balHandle = await cusdc.confidentialBalanceOf(alice.address);
    expect(await unseal(alice, balHandle)).to.equal(SLOT);
  });

  it("operator-model approval lets the auction pull a deposit without an ERC20 allowance", async function () {
    await cusdc.mint(alice.address, Number(SLOT * 2n));
    expect(await cusdc.isOperator(alice.address, auction.address)).to.be.false;

    // Without operator approval, transferFrom must revert.
    const aliceClient = await clientFor(alice);
    const [encAmt] = await aliceClient
      .encryptInputs([Encryptable.uint64(SLOT)])
      .execute();
    await expect(
      cusdc.connect(auction).confidentialTransferFrom(alice.address, bob.address, encAmt)
    ).to.be.revertedWith("ConfidentialToken: not operator");

    // Grant operator authority for the auction.
    await cusdc.connect(alice).setOperator(auction.address, FAR_FUTURE);
    expect(await cusdc.isOperator(alice.address, auction.address)).to.be.true;

    // Now the encrypted pull succeeds and the receiver indicator bumps.
    const indicatorBefore = await cusdc.balanceIndicator(bob.address);
    const [encPull] = await aliceClient
      .encryptInputs([Encryptable.uint64(SLOT)])
      .execute();
    await cusdc.connect(auction).confidentialTransferFrom(alice.address, bob.address, encPull);
    expect(await cusdc.balanceIndicator(bob.address)).to.equal(indicatorBefore + 1n);

    // Bob can unseal his received amount; Alice still holds the remainder.
    const aliceBal = await cusdc.confidentialBalanceOf(alice.address);
    const bobBal = await cusdc.confidentialBalanceOf(bob.address);
    expect(await unseal(alice, aliceBal)).to.equal(SLOT);
    expect(await unseal(bob, bobBal)).to.equal(SLOT);
  });

  it("refund path — per-payout encrypted amount preserves ciphertext after settlement", async function () {
    // Simulate the BondAuction refund pattern: contract holds a pool, then
    // pays each loser back individually. We model the contract as `auction`.
    await cusdc.mint(auction.address, Number(SLOT * 2n));

    // Alice and Bob are losing lenders waiting for refunds.
    const aliceIndicatorBefore = await cusdc.balanceIndicator(alice.address);
    const bobIndicatorBefore = await cusdc.balanceIndicator(bob.address);

    // Each refund creates its own encrypted amount (matches BondAuction.settle).
    const auctionClient = await clientFor(auction);
    const [encRefundA] = await auctionClient
      .encryptInputs([Encryptable.uint64(SLOT)])
      .execute();
    await cusdc.connect(auction).confidentialTransfer(alice.address, encRefundA);

    const [encRefundB] = await auctionClient
      .encryptInputs([Encryptable.uint64(SLOT)])
      .execute();
    await cusdc.connect(auction).confidentialTransfer(bob.address, encRefundB);

    // Indicators bump so frontends know to re-unseal.
    expect(await cusdc.balanceIndicator(alice.address)).to.equal(aliceIndicatorBefore + 1n);
    expect(await cusdc.balanceIndicator(bob.address)).to.equal(bobIndicatorBefore + 1n);

    // Both refunds resolve to the slot size on unseal — but only for the holder.
    const aliceBal = await cusdc.confidentialBalanceOf(alice.address);
    const bobBal = await cusdc.confidentialBalanceOf(bob.address);
    expect(await unseal(alice, aliceBal)).to.equal(SLOT);
    expect(await unseal(bob, bobBal)).to.equal(SLOT);
  });
});
