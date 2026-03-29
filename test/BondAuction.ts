import hre from "hardhat";
import { expect } from "chai";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { BondAuction, MockERC20 } from "../typechain-types";
import { Encryptable, FheTypes } from "@cofhe/sdk";

// Bond parameters
const SLOT_SIZE = 10_000n * 10n ** 6n; // 10,000 USDC (6 decimals)
const SLOT_COUNT = 3n;
const MAX_RATE = 2000n; // 20% in bps
const DURATION = 30n * 24n * 60n * 60n; // 30 days
const BIDDING_DURATION = 3600n; // 1 hour
const MIN_BIDDERS = 5n; // Need more bidders than slots
const COLLATERAL_AMOUNT = 50n * 10n ** 18n; // 50 ETH (18 decimals)

describe("BondAuction", function () {
  let auction: BondAuction;
  let usdc: MockERC20;
  let weth: MockERC20;
  let borrower: HardhatEthersSigner;
  let lenderA: HardhatEthersSigner;
  let lenderB: HardhatEthersSigner;
  let lenderC: HardhatEthersSigner;
  let lenderD: HardhatEthersSigner;
  let lenderE: HardhatEthersSigner;
  let regulator: HardhatEthersSigner;
  let cofheClient: any;

  async function createCofheClient(signer: HardhatEthersSigner) {
    return await hre.cofhe.createClientWithBatteries(signer);
  }

  async function encryptRate(client: any, rate: bigint) {
    const [encrypted] = await client
      .encryptInputs([Encryptable.uint64(rate)])
      .execute();
    return encrypted;
  }

  async function setupBond() {
    // Approve collateral
    await weth.connect(borrower).approve(await auction.getAddress(), COLLATERAL_AMOUNT);

    // Create bond
    const tx = await auction.connect(borrower).createBond(
      await weth.getAddress(),
      COLLATERAL_AMOUNT,
      await usdc.getAddress(),
      SLOT_SIZE,
      SLOT_COUNT,
      MAX_RATE,
      DURATION,
      BIDDING_DURATION,
      MIN_BIDDERS
    );

    const receipt = await tx.wait();
    return 0n; // First bond ID
  }

  async function submitBid(lender: HardhatEthersSigner, bondId: bigint, rateBps: bigint) {
    const client = await createCofheClient(lender);
    const encRate = await encryptRate(client, rateBps);

    await usdc.connect(lender).approve(await auction.getAddress(), SLOT_SIZE);
    await auction.connect(lender).submitRate(bondId, encRate);
  }

  beforeEach(async function () {
    [borrower, lenderA, lenderB, lenderC, lenderD, lenderE, regulator] =
      await hre.ethers.getSigners();

    // Deploy tokens
    const MockERC20Factory = await hre.ethers.getContractFactory("MockERC20");
    usdc = await MockERC20Factory.deploy("USD Coin", "USDC", 6);
    weth = await MockERC20Factory.deploy("Wrapped Ether", "WETH", 18);

    // Deploy auction
    const AuctionFactory = await hre.ethers.getContractFactory("BondAuction");
    auction = await AuctionFactory.deploy();

    // Mint tokens
    await weth.mint(borrower.address, COLLATERAL_AMOUNT * 2n);
    for (const lender of [lenderA, lenderB, lenderC, lenderD, lenderE]) {
      await usdc.mint(lender.address, SLOT_SIZE * 2n);
    }

    cofheClient = await createCofheClient(borrower);
  });

  // =========== Creation ===========

  describe("Bond Creation", function () {
    it("should create a bond with correct parameters", async function () {
      const bondId = await setupBond();
      const bond = await auction.getBond(bondId);

      expect(bond.borrower).to.equal(borrower.address);
      expect(bond.collateralAmount).to.equal(COLLATERAL_AMOUNT);
      expect(bond.slotSize).to.equal(SLOT_SIZE);
      expect(bond.slotCount).to.equal(SLOT_COUNT);
      expect(bond.maxRate).to.equal(MAX_RATE);
      expect(bond.state).to.equal(0n); // Open
    });

    it("should lock collateral on creation", async function () {
      await setupBond();
      expect(await weth.balanceOf(await auction.getAddress())).to.equal(COLLATERAL_AMOUNT);
    });

    it("should revert if minBidders <= slotCount", async function () {
      await weth.connect(borrower).approve(await auction.getAddress(), COLLATERAL_AMOUNT);
      await expect(
        auction.connect(borrower).createBond(
          await weth.getAddress(),
          COLLATERAL_AMOUNT,
          await usdc.getAddress(),
          SLOT_SIZE,
          SLOT_COUNT,
          MAX_RATE,
          DURATION,
          BIDDING_DURATION,
          SLOT_COUNT // minBidders == slotCount, should fail
        )
      ).to.be.revertedWith("BondAuction: minBidders must exceed slotCount");
    });
  });

  // =========== Bidding ===========

  describe("Rate Bidding", function () {
    it("should accept encrypted rate bids", async function () {
      const bondId = await setupBond();

      await submitBid(lenderA, bondId, 450n); // 4.50%
      expect(await auction.getBidCount(bondId)).to.equal(1n);
      expect(await auction.getBidder(bondId, 0n)).to.equal(lenderA.address);
    });

    it("should reject duplicate bids from same address", async function () {
      const bondId = await setupBond();
      await submitBid(lenderA, bondId, 450n);

      const client = await createCofheClient(lenderA);
      const encRate = await encryptRate(client, 500n);
      await usdc.connect(lenderA).approve(await auction.getAddress(), SLOT_SIZE);

      await expect(
        auction.connect(lenderA).submitRate(bondId, encRate)
      ).to.be.revertedWith("BondAuction: already bid");
    });

    it("should reject bids from borrower", async function () {
      const bondId = await setupBond();
      await usdc.mint(borrower.address, SLOT_SIZE);

      const client = await createCofheClient(borrower);
      const encRate = await encryptRate(client, 500n);
      await usdc.connect(borrower).approve(await auction.getAddress(), SLOT_SIZE);

      await expect(
        auction.connect(borrower).submitRate(bondId, encRate)
      ).to.be.revertedWith("BondAuction: borrower cannot bid");
    });
  });

  // =========== Close ===========

  describe("Bond Close", function () {
    it("should close bond after deadline with enough bidders", async function () {
      const bondId = await setupBond();

      // Submit 5 bids (minBidders = 5)
      await submitBid(lenderA, bondId, 300n);
      await submitBid(lenderB, bondId, 420n);
      await submitBid(lenderC, bondId, 350n);
      await submitBid(lenderD, bondId, 510n);
      await submitBid(lenderE, bondId, 380n);

      // Advance time past deadline
      await hre.ethers.provider.send("evm_increaseTime", [3601]);
      await hre.ethers.provider.send("evm_mine", []);

      await auction.closeBond(bondId);
      const bond = await auction.getBond(bondId);
      expect(bond.state).to.equal(1n); // Closed
    });

    it("should cancel if below minBidders", async function () {
      const bondId = await setupBond();
      await submitBid(lenderA, bondId, 300n);

      await hre.ethers.provider.send("evm_increaseTime", [3601]);
      await hre.ethers.provider.send("evm_mine", []);

      await auction.closeBond(bondId);
      const bond = await auction.getBond(bondId);
      expect(bond.state).to.equal(7n); // Cancelled
    });

    it("should allow borrower to cancel before deadline if no bids", async function () {
      const bondId = await setupBond();
      await auction.connect(borrower).cancelBond(bondId);

      const bond = await auction.getBond(bondId);
      expect(bond.state).to.equal(7n); // Cancelled

      // Collateral returned
      expect(await weth.balanceOf(borrower.address)).to.equal(COLLATERAL_AMOUNT * 2n);
    });
  });

  // =========== Full Lifecycle ===========

  describe("Full Bond Lifecycle", function () {
    // Rates: A=300 (3%), B=420 (4.2%), C=350 (3.5%), D=510 (5.1%), E=380 (3.8%)
    // Sorted: A(300), C(350), E(380), B(420), D(510)
    // K=3 slots → Winners: A, C, E → Clearing rate = 380 (E's rate, 3.80%)

    async function setupFullBond() {
      const bondId = await setupBond();

      await submitBid(lenderA, bondId, 300n); // 3.00%
      await submitBid(lenderB, bondId, 420n); // 4.20%
      await submitBid(lenderC, bondId, 350n); // 3.50%
      await submitBid(lenderD, bondId, 510n); // 5.10%
      await submitBid(lenderE, bondId, 380n); // 3.80%

      // Close
      await hre.ethers.provider.send("evm_increaseTime", [3601]);
      await hre.ethers.provider.send("evm_mine", []);
      await auction.closeBond(bondId);

      return bondId;
    }

    it("should resolve K passes correctly", async function () {
      const bondId = await setupFullBond();

      // Pass 1: find min → 300 (A), exclude A
      await auction.resolvePass(bondId);
      let bond = await auction.getBond(bondId);
      expect(bond.currentPass).to.equal(1n);
      expect(bond.state).to.equal(2n); // Resolving

      // Pass 2: find min of remaining → 350 (C), exclude C
      await auction.resolvePass(bondId);
      bond = await auction.getBond(bondId);
      expect(bond.currentPass).to.equal(2n);
      expect(bond.state).to.equal(2n); // Still Resolving

      // Pass 3 (final): find min of remaining → 380 (E) = clearing rate
      await auction.resolvePass(bondId);
      bond = await auction.getBond(bondId);
      expect(bond.currentPass).to.equal(3n);
      expect(bond.state).to.equal(3n); // Resolved
    });

    it("should settle with correct clearing rate and winners", async function () {
      const bondId = await setupFullBond();

      // Resolve all 3 passes
      await auction.resolvePass(bondId);
      await auction.resolvePass(bondId);
      await auction.resolvePass(bondId);

      // Advance time to clear mock's decrypt delay (1-10s)
      await time.increase(10);
      await auction.settle(bondId);

      const bond = await auction.getBond(bondId);
      expect(bond.state).to.equal(4n); // Active
      expect(bond.settledRate).to.equal(380n); // 3.80% clearing rate

      // Winners are A, C, E
      const winnerList = await auction.getWinners(bondId);
      expect(winnerList.length).to.equal(3);

      // Check correct addresses won
      const winnerAddresses = new Set(winnerList.map(w => w.toLowerCase()));
      expect(winnerAddresses.has(lenderA.address.toLowerCase())).to.be.true;
      expect(winnerAddresses.has(lenderC.address.toLowerCase())).to.be.true;
      expect(winnerAddresses.has(lenderE.address.toLowerCase())).to.be.true;

      // Losers (B, D) should be refunded
      expect(await usdc.balanceOf(lenderB.address)).to.equal(SLOT_SIZE * 2n); // Original + refund
      expect(await usdc.balanceOf(lenderD.address)).to.equal(SLOT_SIZE * 2n);

      // Borrower received principal (3 slots)
      const principal = SLOT_SIZE * SLOT_COUNT;
      expect(await usdc.balanceOf(borrower.address)).to.equal(principal);
    });

    it("should handle repayment correctly", async function () {
      const bondId = await setupFullBond();

      await auction.resolvePass(bondId);
      await auction.resolvePass(bondId);
      await auction.resolvePass(bondId);
      await time.increase(10);
      await auction.settle(bondId);

      const bond = await auction.getBond(bondId);
      const totalRepayment = bond.totalRepayment;

      // Mint enough for repayment
      await usdc.mint(borrower.address, totalRepayment);
      await usdc.connect(borrower).approve(await auction.getAddress(), totalRepayment);

      await auction.connect(borrower).repay(bondId);

      const bondAfter = await auction.getBond(bondId);
      expect(bondAfter.state).to.equal(5n); // Repaid

      // Collateral returned to borrower
      expect(await weth.balanceOf(borrower.address)).to.equal(COLLATERAL_AMOUNT * 2n);
    });

    it("should let winners claim after repayment", async function () {
      const bondId = await setupFullBond();

      await auction.resolvePass(bondId);
      await auction.resolvePass(bondId);
      await auction.resolvePass(bondId);
      await time.increase(10);
      await auction.settle(bondId);

      const bond = await auction.getBond(bondId);
      await usdc.mint(borrower.address, bond.totalRepayment);
      await usdc.connect(borrower).approve(await auction.getAddress(), bond.totalRepayment);
      await auction.connect(borrower).repay(bondId);

      // Each winner claims
      const payoutPerLender = bond.totalRepayment / SLOT_COUNT;

      const balBefore = await usdc.balanceOf(lenderA.address);
      await auction.connect(lenderA).claim(bondId);
      const balAfter = await usdc.balanceOf(lenderA.address);
      expect(balAfter - balBefore).to.equal(payoutPerLender);

      // Can't claim twice
      await expect(
        auction.connect(lenderA).claim(bondId)
      ).to.be.revertedWith("BondAuction: not a winner");
    });

    it("should handle liquidation on default", async function () {
      const bondId = await setupFullBond();

      await auction.resolvePass(bondId);
      await auction.resolvePass(bondId);
      await auction.resolvePass(bondId);
      await time.increase(10);
      await auction.settle(bondId);

      // Advance past maturity without repaying
      await hre.ethers.provider.send("evm_increaseTime", [Number(DURATION) + 1]);
      await hre.ethers.provider.send("evm_mine", []);

      const collateralShare = COLLATERAL_AMOUNT / SLOT_COUNT;

      await auction.liquidate(bondId);

      const bondAfter = await auction.getBond(bondId);
      expect(bondAfter.state).to.equal(6n); // Defaulted

      // Each winner gets collateral share
      expect(await weth.balanceOf(lenderA.address)).to.equal(collateralShare);
      expect(await weth.balanceOf(lenderC.address)).to.equal(collateralShare);
      // lenderE gets share + dust
      const dust = COLLATERAL_AMOUNT - (collateralShare * SLOT_COUNT);
      expect(await weth.balanceOf(lenderE.address)).to.equal(collateralShare + dust);
    });
  });

  // =========== Refunds ===========

  describe("Refunds", function () {
    it("should refund bidders on cancelled bond", async function () {
      const bondId = await setupBond();
      await submitBid(lenderA, bondId, 300n);

      // Close with insufficient bidders → cancelled
      await hre.ethers.provider.send("evm_increaseTime", [3601]);
      await hre.ethers.provider.send("evm_mine", []);
      await auction.closeBond(bondId);

      await auction.connect(lenderA).claimRefund(bondId);
      expect(await usdc.balanceOf(lenderA.address)).to.equal(SLOT_SIZE * 2n);
    });

    it("should return collateral on cancelled bond", async function () {
      const bondId = await setupBond();

      await hre.ethers.provider.send("evm_increaseTime", [3601]);
      await hre.ethers.provider.send("evm_mine", []);
      await auction.closeBond(bondId);

      await auction.connect(borrower).claimCollateral(bondId);
      expect(await weth.balanceOf(borrower.address)).to.equal(COLLATERAL_AMOUNT * 2n);
    });
  });

  // =========== Compliance ===========

  describe("Compliance", function () {
    it("should grant compliance access", async function () {
      const bondId = await setupBond();

      await submitBid(lenderA, bondId, 300n);
      await submitBid(lenderB, bondId, 420n);
      await submitBid(lenderC, bondId, 350n);
      await submitBid(lenderD, bondId, 510n);
      await submitBid(lenderE, bondId, 380n);

      await hre.ethers.provider.send("evm_increaseTime", [3601]);
      await hre.ethers.provider.send("evm_mine", []);
      await auction.closeBond(bondId);

      await auction.resolvePass(bondId);
      await auction.resolvePass(bondId);
      await auction.resolvePass(bondId);

      // Borrower grants compliance access
      await auction.connect(borrower).revealForCompliance(bondId, regulator.address);
      expect(await auction.complianceAccess(bondId, regulator.address)).to.be.true;
    });
  });
});
