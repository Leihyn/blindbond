// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@fhenixprotocol/cofhe-contracts/FHE.sol";

/// @title ConfidentialToken — FHERC20 implementation for encrypted balances
///
/// Balances are stored as euint64 (FHE-encrypted). Transfers happen on
/// ciphertext — an observer sees hashes, never amounts. Uses an operator
/// model instead of ERC20 allowances (which would leak balance info).
///
/// Built for BlindBond: lender deposits, payouts, and refunds all flow
/// through encrypted balances so individual positions stay private on-chain.
contract ConfidentialToken {
    string public name;
    string public symbol;
    uint8 public immutable decimals;

    /// @dev Encrypted balances — only the holder (and approved parties) can unseal
    mapping(address => euint64) private _encBalances;

    /// @dev Public balance indicator: increments on every transfer in/out.
    ///      NOT the real balance — just a nonce so clients know when to re-unseal.
    mapping(address => uint256) public balanceIndicator;

    /// @dev Operator approvals: holder → operator → expiry timestamp
    mapping(address => mapping(address => uint48)) public operators;

    uint64 public totalMinted;

    event ConfidentialTransfer(address indexed from, address indexed to);
    event OperatorSet(address indexed holder, address indexed operator, uint48 until);
    event Mint(address indexed to, uint64 amount);

    constructor(string memory _name, string memory _symbol, uint8 _decimals) {
        name = _name;
        symbol = _symbol;
        decimals = _decimals;
    }

    // =========== Operator Model ===========

    /// @notice Grant an operator permission to transfer on your behalf until `until`
    function setOperator(address operator, uint48 until) external {
        operators[msg.sender][operator] = until;
        emit OperatorSet(msg.sender, operator, until);
    }

    /// @notice Check if `spender` is an authorized operator for `holder`
    function isOperator(address holder, address spender) public view returns (bool) {
        return operators[holder][spender] >= block.timestamp;
    }

    // =========== Encrypted Balance ===========

    /// @notice Returns the encrypted balance handle (must unseal with permit)
    function confidentialBalanceOf(address account) external view returns (euint64) {
        return _encBalances[account];
    }

    // =========== Transfers ===========

    /// @notice Transfer `value` tokens to `to` (encrypted amount)
    function confidentialTransfer(address to, euint64 value) external returns (euint64) {
        return _transfer(msg.sender, to, value);
    }

    /// @notice Transfer `value` tokens from `from` to `to` (requires operator approval)
    function confidentialTransferFrom(
        address from,
        address to,
        euint64 value
    ) external returns (euint64) {
        require(
            msg.sender == from || isOperator(from, msg.sender),
            "ConfidentialToken: not operator"
        );
        return _transfer(from, to, value);
    }

    /// @dev Core transfer logic — operates entirely on ciphertext
    ///      If sender has insufficient balance, transferred amount is 0 (no revert).
    ///      This preserves confidentiality: a revert would leak balance info.
    function _transfer(
        address from,
        address to,
        euint64 value
    ) internal returns (euint64 transferred) {
        require(from != address(0), "ConfidentialToken: from zero");
        require(to != address(0), "ConfidentialToken: to zero");

        euint64 fromBal = _encBalances[from];

        // If sender has no balance initialized, transferred = 0
        if (!Common.isInitialized(fromBal)) {
            transferred = FHE.asEuint64(0);
            FHE.allowThis(transferred);
            FHE.allow(transferred, from);
            FHE.allow(transferred, to);
            return transferred;
        }

        // Check if sender has enough: value <= balance
        ebool hasEnough = FHE.lte(value, fromBal);

        // Transferred amount: value if enough, 0 otherwise
        transferred = FHE.select(hasEnough, value, FHE.asEuint64(0));

        // Update sender balance: subtract transferred amount
        euint64 newFromBal = FHE.sub(fromBal, transferred);
        _encBalances[from] = newFromBal;

        // Update receiver balance: add transferred amount
        euint64 toBal = _encBalances[to];
        if (Common.isInitialized(toBal)) {
            _encBalances[to] = FHE.add(toBal, transferred);
        } else {
            _encBalances[to] = transferred;
        }

        // ACL: contract can operate on all new values
        FHE.allowThis(_encBalances[from]);
        FHE.allowThis(_encBalances[to]);
        FHE.allowThis(transferred);

        // ACL: holders can view their own balances
        FHE.allow(_encBalances[from], from);
        FHE.allow(_encBalances[to], to);

        // ACL: both parties can view transferred amount
        FHE.allow(transferred, from);
        FHE.allow(transferred, to);

        // Bump indicators so clients know to re-unseal
        balanceIndicator[from]++;
        balanceIndicator[to]++;

        emit ConfidentialTransfer(from, to);
    }

    // =========== Minting ===========

    /// @notice Mint `amount` tokens to `to` (plaintext amount, stored encrypted)
    function mint(address to, uint64 amount) external {
        euint64 encAmount = FHE.asEuint64(amount);

        if (Common.isInitialized(_encBalances[to])) {
            _encBalances[to] = FHE.add(_encBalances[to], encAmount);
        } else {
            _encBalances[to] = encAmount;
        }

        FHE.allowThis(_encBalances[to]);
        FHE.allow(_encBalances[to], to);

        totalMinted += amount;
        balanceIndicator[to]++;

        emit Mint(to, amount);
    }
}
