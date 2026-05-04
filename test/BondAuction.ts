const hre = require("hardhat");
const { expect } = require("chai");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { BondAuction, MockERC20, ConfidentialToken } from "../typechain-types";
const { Encryptable, FheTypes } = require("@cofhe/sdk");

// Bond parameters
const SLOT_SIZE = 10_000n; // 10,000 USDC (6 decimals applied at mint, slotSize is raw uint64)
const SLOT_SIZE_WITH_DECIMALS = 10_000_000_000n; // 10,000 * 10^6
const SLOT_COUNT = 3n;
const MAX_RATE = 2000n; // 20% in bps
const DURATION = 30n * 24n * 60n * 60n; // 30 days
const BIDDING_DURATION = 3600n; // 1 hour
const MIN_BIDDERS = 5n; // Need more bidders than slots
const COLLATERAL_AMOUNT = 50_000_000_000_000_000_000n; // 50 * 10^18

describe("BondAuction", function () {
  let auction: BondAuction;
  let cusdc: ConfidentialToken; // FHERC20 — encrypted balances
  let weth: MockERC20;          // Standard ERC20 for collateral
  let borrower: HardhatEthersSigner;
  let lenderA: HardhatEthersSigner;
  let lenderB: HardhatEthersSigner;
  let lenderC: HardhatEthersSigner;
  let lenderD: HardhatEthersSigner;
  let lenderE: HardhatEthersSigner;
  let regulator: HardhatEthersSigner;
  let cofheClient: any;

  // Operator approval: far-future expiry
  const OPERATOR_UNTIL = 2000000000; // ~2033

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
    // Approve collateral (standard ERC20)
    await weth.connect(borrower).approve(await auction.getAddress(), COLLATERAL_AMOUNT);

    // Create bond with ConfidentialToken as borrow token
    const tx = await auction.connect(borrower).createBond(
      await weth.getAddress(),
      COLLATERAL_AMOUNT,
      await cusdc.getAddress(),
      SLOT_SIZE_WITH_DECIMALS, // uint64 slot size with decimals
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

    // Set operator approval on ConfidentialToken (replaces ERC20 approve)
    await cusdc.connect(lender).setOperator(await auction.getAddress(), OPERATOR_UNTIL);
    await auction.connect(lender).submitRate(bondId, encRate);
  }

  beforeEach(async function () {
    [borrower, lenderA, lenderB, lenderC, lenderD, lenderE, regulator] =
      await hre.ethers.getSigners();

    // Deploy tokens
    const ConfidentialTokenFactory = await hre.ethers.getContractFactory("ConfidentialToken");
    cusdc = await ConfidentialTokenFactory.deploy("Confidential USD Coin", "cUSDC", 6);

    const MockERC20Factory = await hre.ethers.getContractFactory("MockERC20");
    weth = await MockERC20Factory.deploy("Wrapped Ether", "WETH", 18);

    // Deploy auction
    const AuctionFactory = await hre.ethers.getContractFactory("BondAuction");
    auction = await AuctionFactory.deploy();

    // Mint tokens — ConfidentialToken mints to encrypted balances
    await weth.mint(borrower.address, COLLATERAL_AMOUNT * 2n);
    for (const lender of [lenderA, lenderB, lenderC, lenderD, lenderE]) {
      await cusdc.mint(lender.address, Number(SLOT_SIZE_WITH_DECIMALS * 2n));
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
      expect(bond.slotSize).to.equal(SLOT_SIZE_WITH_DECIMALS);
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
          await cusdc.getAddress(),
          SLOT_SIZE_WITH_DECIMALS,
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
      await cusdc.connect(lenderA).setOperator(await auction.getAddress(), OPERATOR_UNTIL);

      await expect(
        auction.connect(lenderA).submitRate(bondId, encRate)
      ).to.be.revertedWith("BondAuction: already bid");
    });

    it("should reject bids from borrower", async function () {
      const bondId = await setupBond();
      await cusdc.mint(borrower.address, Number(SLOT_SIZE_WITH_DECIMALS));

      const client = await createCofheClient(borrower);
      const encRate = await encryptRate(client, 500n);
      await cusdc.connect(borrower).setOperator(await auction.getAddress(), OPERATOR_UNTIL);

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

      // Losers (B, D) refunded via ConfidentialToken — balances are encrypted
      // so we verify via balanceIndicator (increments on every transfer)
      expect(await cusdc.balanceIndicator(lenderB.address)).to.be.greaterThan(0n);
      expect(await cusdc.balanceIndicator(lenderD.address)).to.be.greaterThan(0n);
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

      // Mint enough for repayment (ConfidentialToken)
      await cusdc.mint(borrower.address, Number(totalRepayment));
      // Set operator for the auction to pull repayment
      await cusdc.connect(borrower).setOperator(await auction.getAddress(), OPERATOR_UNTIL);

      await auction.connect(borrower).repay(bondId);

      const bondAfter = await auction.getBond(bondId);
      expect(bondAfter.state).to.equal(5n); // Repaid

      // Collateral returned to borrower (standard ERC20 — can verify directly)
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
      await cusdc.mint(borrower.address, Number(bond.totalRepayment));
      await cusdc.connect(borrower).setOperator(await auction.getAddress(), OPERATOR_UNTIL);
      await auction.connect(borrower).repay(bondId);

      // Winner claims — payout via ConfidentialToken (encrypted balance)
      const indicatorBefore = await cusdc.balanceIndicator(lenderA.address);
      await auction.connect(lenderA).claim(bondId);
      const indicatorAfter = await cusdc.balanceIndicator(lenderA.address);
      // Balance indicator increments on transfer — proves funds moved
      expect(indicatorAfter).to.be.greaterThan(indicatorBefore);

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

      // Refund via ConfidentialToken — verify indicator increments
      const indicatorBefore = await cusdc.balanceIndicator(lenderA.address);
      await auction.connect(lenderA).claimRefund(bondId);
      const indicatorAfter = await cusdc.balanceIndicator(lenderA.address);
      expect(indicatorAfter).to.be.greaterThan(indicatorBefore);
    });

    it("should return collateral on cancelled bond", async function () {
      const bondId = await setupBond();

      await hre.ethers.provider.send("evm_increaseTime", [3601]);
      await hre.ethers.provider.send("evm_mine", []);
      await auction.closeBond(bondId);

      await auction.connect(borrower).claimCollateral(bondId);
      // Collateral is standard ERC20 — can verify directly
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
