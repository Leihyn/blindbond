// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@fhenixprotocol/cofhe-contracts/FHE.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title BondAuction — Encrypted rate discovery for on-chain credit
///
/// Borrowers post collateral and request loans. Lenders submit FHE-encrypted
/// interest rate bids. An iterated tournament bracket (K passes) finds the
/// clearing rate without decrypting any individual bid. All winning lenders
/// earn the same uniform clearing rate.
///
/// Built on Fhenix CoFHE.
contract BondAuction {
    using SafeERC20 for IERC20;

    // =========== Types ===========

    enum BondState {
        Open,           // Accepting rate bids
        Closed,         // Deadline passed, pending resolution
        Resolving,      // Tournament in progress (between passes)
        Resolved,       // All K passes complete, clearing rate found
        Active,         // Funds transferred, bond is live
        Repaid,         // Borrower repaid, lenders can claim
        Defaulted,      // Maturity passed without repayment
        Cancelled       // Below minBidders or borrower cancelled
    }

    struct Bond {
        address borrower;
        IERC20 collateralToken;
        uint256 collateralAmount;
        IERC20 borrowToken;
        uint256 slotSize;           // Fixed amount per slot (e.g., 10_000 USDC)
        uint256 slotCount;          // K = number of winning lenders needed
        uint64 maxRate;             // Max acceptable rate in bps (e.g., 2000 = 20.00%)
        uint256 duration;           // Bond duration in seconds
        uint256 biddingDeadline;
        uint256 maturity;           // Set at settlement
        uint256 minBidders;

        BondState state;
        uint256 bidCount;
        uint256 currentPass;        // 0-indexed, runs 0..slotCount-1

        euint64 clearingRate;       // Set after final pass (encrypted until decrypted)
        uint64 settledRate;         // Plaintext clearing rate (public after settlement)
        uint256 totalRepayment;     // Principal + interest (set at settlement)
    }

    struct RateBid {
        address lender;
        euint64 encryptedRate;
        bool refunded;
    }

    // =========== Storage ===========

    uint256 public nextBondId;
    mapping(uint256 => Bond) public bonds;
    mapping(uint256 => RateBid[]) internal bids;
    mapping(uint256 => mapping(address => bool)) public hasBid;

    // Iterated tournament state (persists across passes)
    mapping(uint256 => ebool[]) internal excluded;

    // Winner tracking
    mapping(uint256 => mapping(address => bool)) public isWinner;
    mapping(uint256 => address[]) internal winners;

    // Compliance
    mapping(uint256 => mapping(address => bool)) public complianceAccess;

    // =========== Events ===========

    event BondCreated(
        uint256 indexed bondId,
        address indexed borrower,
        uint256 collateralAmount,
        uint256 totalBorrow,
        uint256 slotCount,
        uint64 maxRate,
        uint256 duration,
        uint256 deadline
    );
    event RateBidSubmitted(uint256 indexed bondId, uint256 bidIndex, address indexed lender);
    event BondClosed(uint256 indexed bondId, bool cancelled);
    event PassResolved(uint256 indexed bondId, uint256 pass);
    event BondResolved(uint256 indexed bondId);
    event BondSettled(uint256 indexed bondId, uint64 clearingRate, uint256 totalRepayment);
    event BondRepaid(uint256 indexed bondId, uint256 amount);
    event LenderClaimed(uint256 indexed bondId, address indexed lender, uint256 amount);
    event BondLiquidated(uint256 indexed bondId);
    event RefundClaimed(uint256 indexed bondId, address indexed lender, uint256 amount);
    event BondCancelled(uint256 indexed bondId, string reason);
    event ComplianceAccessGranted(uint256 indexed bondId, address indexed granter, address indexed regulator);

    // =========== Bond Creation ===========

    /// @notice Create a bond request — borrower locks collateral and defines loan terms
    function createBond(
        IERC20 collateralToken,
        uint256 collateralAmount,
        IERC20 borrowToken,
        uint256 slotSize,
        uint256 slotCount,
        uint64 maxRate,
        uint256 duration,
        uint256 biddingDuration,
        uint256 minBidders
    ) external returns (uint256 bondId) {
        require(slotSize > 0, "BondAuction: zero slot size");
        require(slotCount > 0, "BondAuction: zero slot count");
        require(maxRate > 0, "BondAuction: zero max rate");
        require(duration > 0, "BondAuction: zero duration");
        require(biddingDuration > 0, "BondAuction: zero bidding duration");
        require(collateralAmount > 0, "BondAuction: zero collateral");
        require(minBidders > slotCount, "BondAuction: minBidders must exceed slotCount");

        collateralToken.safeTransferFrom(msg.sender, address(this), collateralAmount);

        bondId = nextBondId++;
        Bond storage b = bonds[bondId];
        b.borrower = msg.sender;
        b.collateralToken = collateralToken;
        b.collateralAmount = collateralAmount;
        b.borrowToken = borrowToken;
        b.slotSize = slotSize;
        b.slotCount = slotCount;
        b.maxRate = maxRate;
        b.duration = duration;
        b.biddingDeadline = block.timestamp + biddingDuration;
        b.minBidders = minBidders;
        b.state = BondState.Open;

        emit BondCreated(
            bondId,
            msg.sender,
            collateralAmount,
            slotSize * slotCount,
            slotCount,
            maxRate,
            duration,
            b.biddingDeadline
        );
    }

    // =========== Rate Bidding ===========

    /// @notice Submit an encrypted rate bid — lender deposits one slot of borrowToken
    function submitRate(
        uint256 bondId,
        InEuint64 calldata encRate
    ) external {
        Bond storage b = bonds[bondId];
        require(b.state == BondState.Open, "BondAuction: not open");
        require(block.timestamp < b.biddingDeadline, "BondAuction: deadline passed");
        require(msg.sender != b.borrower, "BondAuction: borrower cannot bid");
        require(!hasBid[bondId][msg.sender], "BondAuction: already bid");

        // Deposit = lending capital
        b.borrowToken.safeTransferFrom(msg.sender, address(this), b.slotSize);

        // Process encrypted rate
        euint64 rate = FHE.asEuint64(encRate);

        // Cap at maxRate — bids above max become maxRate+1 (can never win)
        ebool withinMax = FHE.lte(rate, FHE.asEuint64(b.maxRate));
        euint64 validRate = FHE.select(withinMax, rate, FHE.asEuint64(b.maxRate + 1));

        // ACL: contract can operate, lender can view their own bid
        FHE.allowThis(validRate);
        FHE.allow(validRate, msg.sender);

        // Store bid
        bids[bondId].push(RateBid({
            lender: msg.sender,
            encryptedRate: validRate,
            refunded: false
        }));

        // Initialize excluded flag (false = not yet a winner)
        ebool notExcluded = FHE.asEbool(false);
        FHE.allowThis(notExcluded);
        excluded[bondId].push(notExcluded);

        hasBid[bondId][msg.sender] = true;
        b.bidCount++;

        emit RateBidSubmitted(bondId, bids[bondId].length - 1, msg.sender);
    }

    // =========== Close Bidding ===========

    /// @notice Close bidding after deadline — permissionless
    function closeBond(uint256 bondId) external {
        Bond storage b = bonds[bondId];
        require(b.state == BondState.Open, "BondAuction: not open");
        require(block.timestamp >= b.biddingDeadline, "BondAuction: deadline not reached");

        if (b.bidCount < b.minBidders) {
            b.state = BondState.Cancelled;
            emit BondCancelled(bondId, "below minimum bidders");
        } else {
            b.state = BondState.Closed;
        }

        emit BondClosed(bondId, b.state == BondState.Cancelled);
    }

    /// @notice Borrower cancels before deadline (only if no bids yet)
    function cancelBond(uint256 bondId) external {
        Bond storage b = bonds[bondId];
        require(msg.sender == b.borrower, "BondAuction: not borrower");
        require(b.state == BondState.Open, "BondAuction: not open");
        require(b.bidCount == 0, "BondAuction: has bids");

        b.state = BondState.Cancelled;
        b.collateralToken.safeTransfer(b.borrower, b.collateralAmount);

        emit BondCancelled(bondId, "borrower cancelled");
    }

    // =========== Iterated Tournament Resolution ===========

    /// @notice Execute one pass of the tournament — called K times (once per slot)
    ///
    /// Each pass:
    /// 1. Adjust rates: excluded bids → maxRate+1 (can't win again)
    /// 2. Tournament: find minimum adjusted rate
    /// 3. First-match: identify winner, mark as excluded for next pass
    ///
    /// After pass K-1 (final), the minimum found IS the clearing rate.
    function resolvePass(uint256 bondId) external {
        Bond storage b = bonds[bondId];
        require(
            b.state == BondState.Closed || b.state == BondState.Resolving,
            "BondAuction: not ready for resolution"
        );
        require(b.currentPass < b.slotCount, "BondAuction: all passes complete");

        RateBid[] storage rateBids = bids[bondId];
        uint256 n = rateBids.length;
        euint64 maxRateEnc = FHE.asEuint64(b.maxRate + 1);

        // Step 1+2: Adjust rates and find minimum in combined loop
        euint64[] memory adjusted = new euint64[](n);

        // First element
        adjusted[0] = FHE.select(excluded[bondId][0], maxRateEnc, rateBids[0].encryptedRate);
        FHE.allowThis(adjusted[0]);
        euint64 currentMin = adjusted[0];

        for (uint256 i = 1; i < n; i++) {
            adjusted[i] = FHE.select(excluded[bondId][i], maxRateEnc, rateBids[i].encryptedRate);
            FHE.allowThis(adjusted[i]);

            ebool isLower = FHE.lt(adjusted[i], currentMin);
            currentMin = FHE.select(isLower, adjusted[i], currentMin);
            FHE.allowThis(currentMin);
        }

        // Step 3: First-match — find which bid equals currentMin and isn't excluded
        ebool found = FHE.asEbool(false);
        FHE.allowThis(found);

        for (uint256 i = 0; i < n; i++) {
            ebool isMatch = FHE.eq(adjusted[i], currentMin);
            ebool notFound = FHE.not(found);
            ebool isNewWinner = FHE.and(isMatch, notFound);
            found = FHE.or(found, isNewWinner);
            FHE.allowThis(found);

            // Mark as excluded for future passes
            excluded[bondId][i] = FHE.or(excluded[bondId][i], isNewWinner);
            FHE.allowThis(excluded[bondId][i]);
        }

        b.currentPass++;

        if (b.currentPass == b.slotCount) {
            // Final pass — this minimum IS the clearing rate
            b.clearingRate = currentMin;
            FHE.allowThis(b.clearingRate);

            // Make clearing rate and winner flags publicly decryptable + request decryption
            FHE.allowPublic(b.clearingRate);
            FHE.decrypt(b.clearingRate);
            for (uint256 i = 0; i < n; i++) {
                FHE.allowPublic(excluded[bondId][i]);
                FHE.decrypt(excluded[bondId][i]);
            }

            b.state = BondState.Resolved;
            emit BondResolved(bondId);
        } else {
            b.state = BondState.Resolving;
        }

        emit PassResolved(bondId, b.currentPass - 1);
    }

    // =========== Decryption + Settlement ===========

    /// @notice Publish decryption results (called by off-chain after client-side decryption)
    /// @dev On testnet: client calls cofheClient.decryptForTx() to get signatures
    ///      In mock/tests: getDecryptResultSafe already works without publishing
    function publishResults(
        uint256 bondId,
        uint64 clearingRate,
        bytes calldata rateSignature,
        bool[] calldata winnerFlags,
        bytes[] calldata flagSignatures
    ) external {
        Bond storage b = bonds[bondId];
        require(b.state == BondState.Resolved, "BondAuction: not resolved");

        uint256 n = bids[bondId].length;
        require(winnerFlags.length == n, "BondAuction: wrong flag count");
        require(flagSignatures.length == n, "BondAuction: wrong sig count");

        // Publish clearing rate decryption
        FHE.publishDecryptResult(b.clearingRate, clearingRate, rateSignature);

        // Publish winner flag decryptions
        for (uint256 i = 0; i < n; i++) {
            FHE.publishDecryptResult(excluded[bondId][i], winnerFlags[i], flagSignatures[i]);
        }
    }

    /// @notice Settle the bond after decryption results are available
    function settle(uint256 bondId) external {
        Bond storage b = bonds[bondId];
        require(b.state == BondState.Resolved, "BondAuction: not resolved");

        // Read decrypted clearing rate
        (uint64 clearingRate, bool rateReady) = FHE.getDecryptResultSafe(b.clearingRate);
        require(rateReady, "BondAuction: clearing rate not decrypted yet");
        require(clearingRate > 0, "BondAuction: zero clearing rate");

        // Read decrypted winner flags and identify winners
        RateBid[] storage rateBids = bids[bondId];
        uint256 n = rateBids.length;
        uint256 winnerCount = 0;

        for (uint256 i = 0; i < n; i++) {
            (bool isExcludedFlag, bool flagReady) = FHE.getDecryptResultSafe(excluded[bondId][i]);
            require(flagReady, "BondAuction: winner flag not decrypted yet");

            if (isExcludedFlag) {
                address lender = rateBids[i].lender;
                require(!isWinner[bondId][lender], "BondAuction: duplicate winner");
                isWinner[bondId][lender] = true;
                winners[bondId].push(lender);
                winnerCount++;
            }
        }

        require(winnerCount == b.slotCount, "BondAuction: winner count mismatch");

        // Calculate repayment: principal + interest
        // Interest = (principal * rate_bps * duration) / (365 days * 10000)
        uint256 principal = b.slotSize * b.slotCount;
        uint256 interest = (principal * uint256(clearingRate) * b.duration) / (365 days * 10000);
        uint256 totalRepayment = principal + interest;

        b.settledRate = clearingRate;
        b.totalRepayment = totalRepayment;
        b.maturity = block.timestamp + b.duration;
        b.state = BondState.Active;

        // Transfer loan to borrower
        b.borrowToken.safeTransfer(b.borrower, principal);

        // Refund losing lenders
        for (uint256 i = 0; i < n; i++) {
            if (!isWinner[bondId][rateBids[i].lender] && !rateBids[i].refunded) {
                rateBids[i].refunded = true;
                b.borrowToken.safeTransfer(rateBids[i].lender, b.slotSize);
                emit RefundClaimed(bondId, rateBids[i].lender, b.slotSize);
            }
        }

        emit BondSettled(bondId, clearingRate, totalRepayment);
    }

    // =========== Repayment ===========

    /// @notice Borrower repays the bond (principal + interest at clearing rate)
    function repay(uint256 bondId) external {
        Bond storage b = bonds[bondId];
        require(b.state == BondState.Active, "BondAuction: not active");
        require(msg.sender == b.borrower, "BondAuction: not borrower");

        b.borrowToken.safeTransferFrom(msg.sender, address(this), b.totalRepayment);
        b.collateralToken.safeTransfer(b.borrower, b.collateralAmount);

        b.state = BondState.Repaid;
        emit BondRepaid(bondId, b.totalRepayment);
    }

    /// @notice Winning lender claims principal + proportional interest after repayment
    function claim(uint256 bondId) external {
        Bond storage b = bonds[bondId];
        require(b.state == BondState.Repaid, "BondAuction: not repaid");
        require(isWinner[bondId][msg.sender], "BondAuction: not a winner");

        uint256 payout = b.totalRepayment / b.slotCount;
        isWinner[bondId][msg.sender] = false;

        b.borrowToken.safeTransfer(msg.sender, payout);
        emit LenderClaimed(bondId, msg.sender, payout);
    }

    // =========== Liquidation ===========

    /// @notice Liquidate a defaulted bond — permissionless after maturity
    function liquidate(uint256 bondId) external {
        Bond storage b = bonds[bondId];
        require(b.state == BondState.Active, "BondAuction: not active");
        require(block.timestamp > b.maturity, "BondAuction: not past maturity");

        b.state = BondState.Defaulted;

        uint256 sharePerLender = b.collateralAmount / b.slotCount;
        address[] storage winnerList = winners[bondId];

        for (uint256 i = 0; i < winnerList.length; i++) {
            if (isWinner[bondId][winnerList[i]]) {
                isWinner[bondId][winnerList[i]] = false;
                b.collateralToken.safeTransfer(winnerList[i], sharePerLender);
            }
        }

        uint256 dust = b.collateralAmount - (sharePerLender * b.slotCount);
        if (dust > 0 && winnerList.length > 0) {
            b.collateralToken.safeTransfer(winnerList[winnerList.length - 1], dust);
        }

        emit BondLiquidated(bondId);
    }

    // =========== Refunds ===========

    /// @notice Claim deposit refund from a cancelled bond
    function claimRefund(uint256 bondId) external {
        Bond storage b = bonds[bondId];
        require(b.state == BondState.Cancelled, "BondAuction: not cancelled");
        require(hasBid[bondId][msg.sender], "BondAuction: no bid to refund");

        RateBid[] storage rateBids = bids[bondId];
        for (uint256 i = 0; i < rateBids.length; i++) {
            if (rateBids[i].lender == msg.sender && !rateBids[i].refunded) {
                rateBids[i].refunded = true;
                b.borrowToken.safeTransfer(msg.sender, b.slotSize);
                emit RefundClaimed(bondId, msg.sender, b.slotSize);
                return;
            }
        }
        revert("BondAuction: already refunded");
    }

    /// @notice Borrower reclaims collateral from a cancelled bond
    function claimCollateral(uint256 bondId) external {
        Bond storage b = bonds[bondId];
        require(b.state == BondState.Cancelled, "BondAuction: not cancelled");
        require(msg.sender == b.borrower, "BondAuction: not borrower");
        require(b.collateralAmount > 0, "BondAuction: already claimed");

        uint256 amount = b.collateralAmount;
        b.collateralAmount = 0;
        b.collateralToken.safeTransfer(b.borrower, amount);
    }

    // =========== Compliance ===========

    /// @notice Grant a regulator decryption access to individual rate bids
    function revealForCompliance(uint256 bondId, address regulator) external {
        Bond storage b = bonds[bondId];
        require(
            b.state >= BondState.Resolved,
            "BondAuction: not resolved yet"
        );
        require(
            msg.sender == b.borrower || isWinner[bondId][msg.sender],
            "BondAuction: not authorized"
        );

        FHE.allow(b.clearingRate, regulator);

        RateBid[] storage rateBids = bids[bondId];
        for (uint256 i = 0; i < rateBids.length; i++) {
            if (isWinner[bondId][rateBids[i].lender]) {
                FHE.allow(rateBids[i].encryptedRate, regulator);
            }
        }

        complianceAccess[bondId][regulator] = true;
        emit ComplianceAccessGranted(bondId, msg.sender, regulator);
    }

    // =========== View Functions ===========

    function getBond(uint256 bondId) external view returns (
        address borrower,
        address collateralToken,
        uint256 collateralAmount,
        address borrowToken,
        uint256 slotSize,
        uint256 slotCount,
        uint64 maxRate,
        uint256 duration,
        uint256 biddingDeadline,
        uint256 maturity,
        BondState state,
        uint256 bidCount,
        uint256 currentPass,
        uint64 settledRate,
        uint256 totalRepayment
    ) {
        Bond storage b = bonds[bondId];
        return (
            b.borrower,
            address(b.collateralToken),
            b.collateralAmount,
            address(b.borrowToken),
            b.slotSize,
            b.slotCount,
            b.maxRate,
            b.duration,
            b.biddingDeadline,
            b.maturity,
            b.state,
            b.bidCount,
            b.currentPass,
            b.settledRate,
            b.totalRepayment
        );
    }

    function getBidCount(uint256 bondId) external view returns (uint256) {
        return bids[bondId].length;
    }

    function getBidder(uint256 bondId, uint256 bidIndex) external view returns (address) {
        return bids[bondId][bidIndex].lender;
    }

    function getWinners(uint256 bondId) external view returns (address[] memory) {
        return winners[bondId];
    }

    function getEncryptedRate(uint256 bondId, uint256 bidIndex) external view returns (euint64) {
        return bids[bondId][bidIndex].encryptedRate;
    }
}
