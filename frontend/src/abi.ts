export const BOND_AUCTION_ABI = [
  // createBond
  {
    inputs: [
      { name: "collateralToken", type: "address" },
      { name: "collateralAmount", type: "uint256" },
      { name: "borrowToken", type: "address" },
      { name: "slotSize", type: "uint256" },
      { name: "slotCount", type: "uint256" },
      { name: "maxRate", type: "uint64" },
      { name: "duration", type: "uint256" },
      { name: "biddingDuration", type: "uint256" },
      { name: "minBidders", type: "uint256" },
    ],
    name: "createBond",
    outputs: [{ name: "bondId", type: "uint256" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  // submitRate
  {
    inputs: [
      { name: "bondId", type: "uint256" },
      {
        name: "encRate",
        type: "tuple",
        components: [
          { name: "ctHash", type: "uint256" },
          { name: "securityZone", type: "int32" },
          { name: "utype", type: "uint8" },
          { name: "signature", type: "bytes" },
        ],
      },
    ],
    name: "submitRate",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  // closeBond
  {
    inputs: [{ name: "bondId", type: "uint256" }],
    name: "closeBond",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  // resolvePass
  {
    inputs: [{ name: "bondId", type: "uint256" }],
    name: "resolvePass",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  // settle
  {
    inputs: [{ name: "bondId", type: "uint256" }],
    name: "settle",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  // repay
  {
    inputs: [{ name: "bondId", type: "uint256" }],
    name: "repay",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  // claim
  {
    inputs: [{ name: "bondId", type: "uint256" }],
    name: "claim",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  // liquidate
  {
    inputs: [{ name: "bondId", type: "uint256" }],
    name: "liquidate",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  // getBond
  {
    inputs: [{ name: "bondId", type: "uint256" }],
    name: "getBond",
    outputs: [
      { name: "borrower", type: "address" },
      { name: "collateralToken", type: "address" },
      { name: "collateralAmount", type: "uint256" },
      { name: "borrowToken", type: "address" },
      { name: "slotSize", type: "uint256" },
      { name: "slotCount", type: "uint256" },
      { name: "maxRate", type: "uint64" },
      { name: "duration", type: "uint256" },
      { name: "biddingDeadline", type: "uint256" },
      { name: "maturity", type: "uint256" },
      { name: "state", type: "uint8" },
      { name: "bidCount", type: "uint256" },
      { name: "currentPass", type: "uint256" },
      { name: "settledRate", type: "uint64" },
      { name: "totalRepayment", type: "uint256" },
    ],
    stateMutability: "view",
    type: "function",
  },
  // getBidCount
  {
    inputs: [{ name: "bondId", type: "uint256" }],
    name: "getBidCount",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  // getWinners
  {
    inputs: [{ name: "bondId", type: "uint256" }],
    name: "getWinners",
    outputs: [{ name: "", type: "address[]" }],
    stateMutability: "view",
    type: "function",
  },
  // nextBondId
  {
    inputs: [],
    name: "nextBondId",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  // hasBid
  {
    inputs: [
      { name: "", type: "uint256" },
      { name: "", type: "address" },
    ],
    name: "hasBid",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  // isWinner
  {
    inputs: [
      { name: "", type: "uint256" },
      { name: "", type: "address" },
    ],
    name: "isWinner",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  // events
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "bondId", type: "uint256" },
      { indexed: true, name: "borrower", type: "address" },
      { indexed: false, name: "collateralAmount", type: "uint256" },
      { indexed: false, name: "totalBorrow", type: "uint256" },
      { indexed: false, name: "slotCount", type: "uint256" },
      { indexed: false, name: "maxRate", type: "uint64" },
      { indexed: false, name: "duration", type: "uint256" },
      { indexed: false, name: "deadline", type: "uint256" },
    ],
    name: "BondCreated",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "bondId", type: "uint256" },
      { indexed: false, name: "clearingRate", type: "uint64" },
      { indexed: false, name: "totalRepayment", type: "uint256" },
    ],
    name: "BondSettled",
    type: "event",
  },
] as const;

export const ERC20_ABI = [
  {
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    name: "approve",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    name: "mint",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "decimals",
    outputs: [{ name: "", type: "uint8" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    name: "allowance",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;
