import { useState, useEffect, useCallback } from "react";
import {
  useAccount,
  useConnect,
  useDisconnect,
  useReadContract,
  useReadContracts,
  useWriteContract,
  useWaitForTransactionReceipt,
  usePublicClient,
  useWalletClient,
} from "wagmi";
import { injected } from "wagmi/connectors";
import { parseUnits, formatUnits } from "viem";
import { BOND_AUCTION_ABI, ERC20_ABI } from "./abi";
import addresses from "./addresses.json";
import "./App.css";

const BOND_STATES = [
  "Open",
  "Closed",
  "Resolving",
  "Resolved",
  "Active",
  "Repaid",
  "Defaulted",
  "Cancelled",
];

const AUCTION_ADDR = addresses.BondAuction as `0x${string}`;
const USDC_ADDR = addresses.USDC as `0x${string}`;
const WETH_ADDR = addresses.WETH as `0x${string}`;

// ============================================================
// Shared hooks
// ============================================================

function useTxFlow() {
  const { writeContract, data: hash, isPending, error, reset } = useWriteContract();
  const { isSuccess, isLoading: isConfirming } = useWaitForTransactionReceipt({ hash });
  return { writeContract, hash, isPending, isConfirming, isSuccess, error, reset };
}

function useBalances() {
  const { address } = useAccount();

  const { data: usdcBal } = useReadContract({
    address: USDC_ADDR,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address, refetchInterval: 10000 },
  });

  const { data: wethBal } = useReadContract({
    address: WETH_ADDR,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address, refetchInterval: 10000 },
  });

  return {
    usdc: usdcBal ? formatUnits(usdcBal as bigint, 6) : "0",
    weth: wethBal ? formatUnits(wethBal as bigint, 18) : "0",
  };
}

function Countdown({ deadline }: { deadline: number }) {
  const [remaining, setRemaining] = useState("");

  useEffect(() => {
    const tick = () => {
      const now = Math.floor(Date.now() / 1000);
      const diff = deadline - now;
      if (diff <= 0) {
        setRemaining("Expired");
        return;
      }
      const m = Math.floor(diff / 60);
      const s = diff % 60;
      setRemaining(`${m}m ${s.toString().padStart(2, "0")}s`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [deadline]);

  return <span className={remaining === "Expired" ? "text-dim" : "text-live"}>{remaining}</span>;
}

function TxStatus({ hash, error, isSuccess }: { hash?: string; error?: any; isSuccess?: boolean }) {
  if (error) {
    const msg = error?.shortMessage || error?.message || "Transaction failed";
    return <p className="error">{msg.length > 120 ? msg.slice(0, 120) + "..." : msg}</p>;
  }
  if (isSuccess && hash) {
    return (
      <p className="success">
        Confirmed{" "}
        <a
          href={`https://sepolia.arbiscan.io/tx/${hash}`}
          target="_blank"
          rel="noreferrer"
          className="tx-link"
        >
          {hash.slice(0, 10)}...
        </a>
      </p>
    );
  }
  if (hash && !isSuccess) {
    return <p className="pending">Confirming...</p>;
  }
  return null;
}

// ============================================================
// Header
// ============================================================

function Header() {
  const { address, isConnected } = useAccount();
  const { connect } = useConnect();
  const { disconnect } = useDisconnect();
  const balances = useBalances();

  return (
    <header>
      <div className="header-content">
        <div className="header-left">
          <img src="/logo.jpg" alt="BlindBond" className="logo" />
          <div className="header-text">
            <h1>BlindBond</h1>
            <p className="tagline">Encrypted Rate Discovery</p>
          </div>
        </div>
        {isConnected ? (
          <div className="wallet">
            <div className="wallet-info">
              <span className="address">
                {address?.slice(0, 6)}...{address?.slice(-4)}
              </span>
              <span className="balances">
                {Number(balances.usdc).toLocaleString()} USDC | {Number(balances.weth).toFixed(2)} WETH
              </span>
            </div>
            <button onClick={() => disconnect()} className="btn-secondary">
              Disconnect
            </button>
          </div>
        ) : (
          <button
            onClick={() => connect({ connector: injected() })}
            className="btn-primary"
          >
            Connect Wallet
          </button>
        )}
      </div>
    </header>
  );
}

// ============================================================
// Mint Tokens
// ============================================================

function MintTokens() {
  const { address } = useAccount();
  const tx1 = useTxFlow();
  const tx2 = useTxFlow();

  const mintUSDC = () => {
    if (!address) return;
    tx1.reset();
    tx1.writeContract({
      address: USDC_ADDR,
      abi: ERC20_ABI,
      functionName: "mint",
      args: [address, parseUnits("100000", 6)],
    });
  };

  const mintWETH = () => {
    if (!address) return;
    tx2.reset();
    tx2.writeContract({
      address: WETH_ADDR,
      abi: ERC20_ABI,
      functionName: "mint",
      args: [address, parseUnits("100", 18)],
    });
  };

  return (
    <section className="card">
      <h2>Testnet Faucet</h2>
      <div className="btn-row">
        <button onClick={mintUSDC} disabled={tx1.isPending} className="btn-secondary">
          {tx1.isPending ? "Minting..." : "Mint 100K USDC"}
        </button>
        <button onClick={mintWETH} disabled={tx2.isPending} className="btn-secondary">
          {tx2.isPending ? "Minting..." : "Mint 100 WETH"}
        </button>
      </div>
      <TxStatus hash={tx1.hash} error={tx1.error} isSuccess={tx1.isSuccess} />
      <TxStatus hash={tx2.hash} error={tx2.error} isSuccess={tx2.isSuccess} />
    </section>
  );
}

// ============================================================
// Create Bond
// ============================================================

function CreateBond() {
  const approveTx = useTxFlow();
  const createTx = useTxFlow();
  const [approveComplete, setApproveComplete] = useState(false);

  const [form, setForm] = useState({
    collateralAmount: "1",
    slotSize: "100",
    slotCount: "3",
    maxRate: "2000",
    duration: "30",
    biddingDuration: "600",
    minBidders: "5",
  });

  useEffect(() => {
    if (approveTx.isSuccess) setApproveComplete(true);
  }, [approveTx.isSuccess]);

  const handleApprove = () => {
    approveTx.reset();
    setApproveComplete(false);
    const collateralWei = parseUnits(form.collateralAmount, 18);
    approveTx.writeContract({
      address: WETH_ADDR,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [AUCTION_ADDR, collateralWei],
    });
  };

  const handleCreate = () => {
    createTx.reset();
    const collateralWei = parseUnits(form.collateralAmount, 18);
    const slotSizeWei = parseUnits(form.slotSize, 6);

    createTx.writeContract({
      address: AUCTION_ADDR,
      abi: BOND_AUCTION_ABI,
      functionName: "createBond",
      args: [
        WETH_ADDR,
        collateralWei,
        USDC_ADDR,
        slotSizeWei,
        BigInt(form.slotCount),
        BigInt(form.maxRate),
        BigInt(Number(form.duration) * 86400),
        BigInt(form.biddingDuration),
        BigInt(form.minBidders),
      ],
    });
  };

  const totalBorrow = Number(form.slotSize) * Number(form.slotCount);

  return (
    <section className="card">
      <h2>Create Bond Request</h2>
      <p className="desc">
        Post collateral and request a loan. Lenders bid encrypted rates.
        Total borrow: {totalBorrow.toLocaleString()} USDC
      </p>
      <div className="form-grid">
        <label>
          Collateral (WETH)
          <input type="text" value={form.collateralAmount}
            onChange={(e) => setForm({ ...form, collateralAmount: e.target.value })} />
        </label>
        <label>
          Slot Size (USDC)
          <input type="text" value={form.slotSize}
            onChange={(e) => setForm({ ...form, slotSize: e.target.value })} />
        </label>
        <label>
          Slots (K)
          <input type="text" value={form.slotCount}
            onChange={(e) => setForm({ ...form, slotCount: e.target.value })} />
        </label>
        <label>
          Max Rate (bps)
          <input type="text" value={form.maxRate}
            onChange={(e) => setForm({ ...form, maxRate: e.target.value })} />
          <span className="field-hint">{(Number(form.maxRate) / 100).toFixed(2)}%</span>
        </label>
        <label>
          Duration (days)
          <input type="text" value={form.duration}
            onChange={(e) => setForm({ ...form, duration: e.target.value })} />
        </label>
        <label>
          Bidding Window (sec)
          <input type="text" value={form.biddingDuration}
            onChange={(e) => setForm({ ...form, biddingDuration: e.target.value })} />
          <span className="field-hint">{(Number(form.biddingDuration) / 60).toFixed(0)} min</span>
        </label>
        <label>
          Min Bidders
          <input type="text" value={form.minBidders}
            onChange={(e) => setForm({ ...form, minBidders: e.target.value })} />
        </label>
      </div>
      <div className="btn-row">
        <button onClick={handleApprove}
          disabled={approveTx.isPending || approveTx.isConfirming}
          className={approveComplete ? "btn-done" : "btn-secondary"}>
          {approveTx.isPending ? "Approving..." : approveComplete ? "Approved" : "1. Approve WETH"}
        </button>
        <button onClick={handleCreate}
          disabled={createTx.isPending || createTx.isConfirming || !approveComplete}
          className="btn-primary">
          {createTx.isPending ? "Creating..." : "2. Create Bond"}
        </button>
      </div>
      <TxStatus hash={approveTx.hash} error={approveTx.error} isSuccess={approveTx.isSuccess} />
      <TxStatus hash={createTx.hash} error={createTx.error} isSuccess={createTx.isSuccess} />
    </section>
  );
}

// ============================================================
// Submit Bid
// ============================================================

function SubmitBid() {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const approveTx = useTxFlow();
  const bidTx = useTxFlow();

  const [bondId, setBondId] = useState("0");
  const [rateBps, setRateBps] = useState("450");
  const [encrypting, setEncrypting] = useState(false);
  const [encryptError, setEncryptError] = useState("");
  const [approveComplete, setApproveComplete] = useState(false);

  // Read bond to get actual slot size
  const { data: bondData } = useReadContract({
    address: AUCTION_ADDR,
    abi: BOND_AUCTION_ABI,
    functionName: "getBond",
    args: [BigInt(bondId || "0")],
  });

  const { data: alreadyBid } = useReadContract({
    address: AUCTION_ADDR,
    abi: BOND_AUCTION_ABI,
    functionName: "hasBid",
    args: address ? [BigInt(bondId || "0"), address] : undefined,
    query: { enabled: !!address },
  });

  const bond = bondData as any;
  const slotSize = bond ? (bond[4] as bigint) : 0n;
  const bondState = bond ? Number(bond[10]) : -1;

  useEffect(() => {
    if (approveTx.isSuccess) setApproveComplete(true);
  }, [approveTx.isSuccess]);

  const handleApprove = () => {
    if (!slotSize) return;
    approveTx.reset();
    setApproveComplete(false);
    approveTx.writeContract({
      address: USDC_ADDR,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [AUCTION_ADDR, slotSize],
    });
  };

  const handleSubmitBid = async () => {
    if (!publicClient || !walletClient) return;
    setEncryptError("");

    try {
      setEncrypting(true);
      const { createCofheClient, createCofheConfig, Encryptable } = await import("@cofhe/sdk/web");
      const { arbSepolia } = await import("@cofhe/sdk/chains");

      const config = createCofheConfig({ supportedChains: [arbSepolia] });
      const client = createCofheClient(config);
      await client.connect(publicClient as any, walletClient as any);

      const [encryptedRate] = await client
        .encryptInputs([Encryptable.uint64(BigInt(rateBps))])
        .execute();

      setEncrypting(false);

      bidTx.reset();
      bidTx.writeContract({
        address: AUCTION_ADDR,
        abi: BOND_AUCTION_ABI,
        functionName: "submitRate",
        args: [BigInt(bondId), encryptedRate as any],
      });
    } catch (err: any) {
      setEncrypting(false);
      setEncryptError(err?.message?.slice(0, 120) || "Encryption failed");
    }
  };

  return (
    <section className="card">
      <h2>Submit Encrypted Rate Bid</h2>
      <p className="desc">
        Your rate is encrypted client-side with FHE. The contract never sees the plaintext.
      </p>
      <div className="form-grid">
        <label>
          Bond ID
          <input type="text" value={bondId} onChange={(e) => setBondId(e.target.value)} />
          {bond && <span className="field-hint">
            {bondState === 0 ? "Open" : BOND_STATES[bondState] || "Unknown"} | Slot: {slotSize ? formatUnits(slotSize, 6) : "?"} USDC
          </span>}
        </label>
        <label>
          Rate (bps)
          <input type="text" value={rateBps} onChange={(e) => setRateBps(e.target.value)} />
          <span className="field-hint">{(Number(rateBps) / 100).toFixed(2)}%</span>
        </label>
      </div>

      {alreadyBid && <p className="error">You already bid on this bond.</p>}

      <div className="btn-row">
        <button onClick={handleApprove}
          disabled={approveTx.isPending || !slotSize || bondState !== 0}
          className={approveComplete ? "btn-done" : "btn-secondary"}>
          {approveTx.isPending ? "Approving..." : approveComplete ? "Approved" : `1. Approve ${slotSize ? formatUnits(slotSize, 6) : "?"} USDC`}
        </button>
        <button onClick={handleSubmitBid}
          disabled={bidTx.isPending || encrypting || !approveComplete || bondState !== 0 || !!alreadyBid}
          className="btn-primary">
          {encrypting ? "Encrypting with FHE..." : bidTx.isPending ? "Submitting..." : "2. Encrypt & Submit"}
        </button>
      </div>
      {encryptError && <p className="error">{encryptError}</p>}
      <TxStatus hash={approveTx.hash} error={approveTx.error} isSuccess={approveTx.isSuccess} />
      <TxStatus hash={bidTx.hash} error={bidTx.error} isSuccess={bidTx.isSuccess} />
    </section>
  );
}

// ============================================================
// Bond Dashboard
// ============================================================

function BondDashboard() {
  const { address } = useAccount();
  const [bondId, setBondId] = useState("0");
  const tx = useTxFlow();

  const { data: bondData, refetch } = useReadContract({
    address: AUCTION_ADDR,
    abi: BOND_AUCTION_ABI,
    functionName: "getBond",
    args: [BigInt(bondId || "0")],
    query: { refetchInterval: 8000 },
  });

  const { data: bidCount, refetch: refetchBids } = useReadContract({
    address: AUCTION_ADDR,
    abi: BOND_AUCTION_ABI,
    functionName: "getBidCount",
    args: [BigInt(bondId || "0")],
    query: { refetchInterval: 8000 },
  });

  const { data: winnersData } = useReadContract({
    address: AUCTION_ADDR,
    abi: BOND_AUCTION_ABI,
    functionName: "getWinners",
    args: [BigInt(bondId || "0")],
    query: { refetchInterval: 8000 },
  });

  const { data: isWinnerData } = useReadContract({
    address: AUCTION_ADDR,
    abi: BOND_AUCTION_ABI,
    functionName: "isWinner",
    args: address ? [BigInt(bondId || "0"), address] : undefined,
    query: { enabled: !!address, refetchInterval: 8000 },
  });

  const { data: nextBondId } = useReadContract({
    address: AUCTION_ADDR,
    abi: BOND_AUCTION_ABI,
    functionName: "nextBondId",
    query: { refetchInterval: 15000 },
  });

  const bond = bondData as any;
  const state = bond ? Number(bond[10]) : -1;
  const slotCount = bond ? Number(bond[5]) : 0;
  const currentPass = bond ? Number(bond[12]) : 0;
  const settledRate = bond ? Number(bond[13]) : 0;
  const totalRepayment = bond ? bond[14] : 0n;
  const deadline = bond ? Number(bond[8]) : 0;
  const maturity = bond ? Number(bond[9]) : 0;
  const borrower = bond ? (bond[0] as string) : "";
  const isBorrower = address && borrower.toLowerCase() === address.toLowerCase();
  const isWinner = !!isWinnerData;
  const winners = winnersData as string[] | undefined;
  const totalBonds = nextBondId ? Number(nextBondId) : 0;

  useEffect(() => {
    if (tx.isSuccess) {
      refetch();
      refetchBids();
    }
  }, [tx.isSuccess]);

  const handleAction = (fn: string) => {
    tx.reset();
    tx.writeContract({
      address: AUCTION_ADDR,
      abi: BOND_AUCTION_ABI,
      functionName: fn as any,
      args: [BigInt(bondId)],
    });
  };

  // Role badge
  let role = "";
  if (isBorrower) role = "You are the borrower";
  else if (isWinner) role = "You are a winning lender";
  else if (address && bond) {
    role = "Observer";
  }

  return (
    <section className="card">
      <h2>Bond Dashboard</h2>
      <div className="form-grid">
        <label>
          Bond ID
          <div style={{ display: "flex", gap: "8px" }}>
            <input type="text" value={bondId}
              onChange={(e) => setBondId(e.target.value)} style={{ flex: 1 }} />
            <button onClick={() => refetch()} className="btn-secondary">Load</button>
          </div>
          {totalBonds > 0 && <span className="field-hint">{totalBonds} bonds created</span>}
        </label>
      </div>

      {bond && state >= 0 && (
        <div className="bond-info">
          {role && <div className="role-badge">{role}</div>}

          <div className="info-grid">
            <div className="info-item">
              <span className="label">State</span>
              <span className={`badge state-${state}`}>
                {BOND_STATES[state] || "Unknown"}
              </span>
            </div>
            <div className="info-item">
              <span className="label">Borrower</span>
              <span className="mono">
                {borrower.slice(0, 8)}...{borrower.slice(-4)}
              </span>
            </div>
            <div className="info-item">
              <span className="label">Total Borrow</span>
              <span>{formatUnits(BigInt(bond[4]) * BigInt(bond[5]), 6)} USDC</span>
            </div>
            <div className="info-item">
              <span className="label">Collateral</span>
              <span>{formatUnits(bond[2], 18)} WETH</span>
            </div>
            <div className="info-item">
              <span className="label">Slots</span>
              <span>{slotCount} x {formatUnits(bond[4], 6)} USDC</span>
            </div>
            <div className="info-item">
              <span className="label">Max Rate</span>
              <span>{(Number(bond[6]) / 100).toFixed(2)}%</span>
            </div>
            <div className="info-item">
              <span className="label">Bids</span>
              <span>{bidCount?.toString() || "0"}</span>
            </div>
            <div className="info-item">
              <span className="label">Resolution</span>
              <span>Pass {currentPass} / {slotCount}</span>
            </div>
            {deadline > 0 && (
              <div className="info-item">
                <span className="label">{state === 0 ? "Deadline" : "Bidding Ended"}</span>
                {state === 0 ? <Countdown deadline={deadline} /> : <span>{new Date(deadline * 1000).toLocaleString()}</span>}
              </div>
            )}
            {settledRate > 0 && (
              <div className="info-item highlight">
                <span className="label">Clearing Rate</span>
                <span>{(settledRate / 100).toFixed(2)}%</span>
              </div>
            )}
            {totalRepayment > 0n && (
              <div className="info-item">
                <span className="label">Total Repayment</span>
                <span>{formatUnits(totalRepayment, 6)} USDC</span>
              </div>
            )}
            {maturity > 0 && (
              <div className="info-item">
                <span className="label">Maturity</span>
                {state === 4 ? <Countdown deadline={maturity} /> : <span>{new Date(maturity * 1000).toLocaleString()}</span>}
              </div>
            )}
          </div>

          {winners && winners.length > 0 && (
            <div className="winners">
              <h3>Winners ({winners.length})</h3>
              {winners.map((w, i) => (
                <span key={i} className={`mono winner-addr ${address && w.toLowerCase() === address.toLowerCase() ? "winner-you" : ""}`}>
                  {w.slice(0, 8)}...{w.slice(-4)}
                  {address && w.toLowerCase() === address.toLowerCase() && " (you)"}
                </span>
              ))}
            </div>
          )}

          <div className="btn-row">
            {state === 0 && (
              <button onClick={() => handleAction("closeBond")}
                disabled={tx.isPending} className="btn-secondary">
                {tx.isPending ? "Closing..." : "Close Bidding"}
              </button>
            )}
            {(state === 1 || state === 2) && currentPass < slotCount && (
              <button onClick={() => handleAction("resolvePass")}
                disabled={tx.isPending} className="btn-primary">
                {tx.isPending ? "Resolving..." : `Resolve Pass ${currentPass + 1}/${slotCount}`}
              </button>
            )}
            {state === 3 && (
              <button onClick={() => handleAction("settle")}
                disabled={tx.isPending} className="btn-primary">
                {tx.isPending ? "Settling..." : "Settle Bond"}
              </button>
            )}
            {state === 4 && isBorrower && (
              <button onClick={() => handleAction("repay")}
                disabled={tx.isPending} className="btn-primary">
                {tx.isPending ? "Repaying..." : "Repay Bond"}
              </button>
            )}
            {state === 5 && isWinner && (
              <button onClick={() => handleAction("claim")}
                disabled={tx.isPending} className="btn-primary">
                {tx.isPending ? "Claiming..." : "Claim Payout"}
              </button>
            )}
            {state === 4 && !isBorrower && (
              <button onClick={() => handleAction("liquidate")}
                disabled={tx.isPending} className="btn-danger">
                {tx.isPending ? "Liquidating..." : "Liquidate"}
              </button>
            )}
            {state === 7 && isBorrower && (
              <button onClick={() => handleAction("claimCollateral")}
                disabled={tx.isPending} className="btn-secondary">
                Reclaim Collateral
              </button>
            )}
            {state === 7 && !isBorrower && (
              <button onClick={() => handleAction("claimRefund")}
                disabled={tx.isPending} className="btn-secondary">
                Claim Refund
              </button>
            )}
          </div>
          <TxStatus hash={tx.hash} error={tx.error} isSuccess={tx.isSuccess} />
        </div>
      )}
    </section>
  );
}

// ============================================================
// How It Works (collapsed by default)
// ============================================================

function HowItWorks() {
  const [open, setOpen] = useState(false);

  return (
    <section className="card how-it-works">
      <button className="collapse-toggle" onClick={() => setOpen(!open)}>
        <h2>How It Works</h2>
        <span className="toggle-icon">{open ? "-" : "+"}</span>
      </button>
      {open && (
        <div className="steps">
          <div className="step">
            <div className="step-num">1</div>
            <div>
              <strong>Borrower creates bond</strong>
              <p>Posts collateral, defines loan size, slot count (K), max rate, duration</p>
            </div>
          </div>
          <div className="step">
            <div className="step-num">2</div>
            <div>
              <strong>Lenders bid encrypted rates</strong>
              <p>Each rate is FHE-encrypted client-side. The contract never sees plaintext rates.</p>
            </div>
          </div>
          <div className="step">
            <div className="step-num">3</div>
            <div>
              <strong>Iterated tournament (K passes)</strong>
              <p>Each pass finds the lowest encrypted rate and excludes that winner. After K passes, the K-th lowest rate = clearing rate.</p>
            </div>
          </div>
          <div className="step">
            <div className="step-num">4</div>
            <div>
              <strong>Uniform price settlement</strong>
              <p>All K winners earn the clearing rate. Individual bid rates stay encrypted forever.</p>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// ============================================================
// App
// ============================================================

export default function App() {
  const { isConnected } = useAccount();

  return (
    <div className="app">
      <Header />
      <main>
        {isConnected ? (
          <>
            <BondDashboard />
            <SubmitBid />
            <CreateBond />
            <MintTokens />
          </>
        ) : (
          <section className="card connect-prompt">
            <p>Connect your wallet to interact with BlindBond on Arbitrum Sepolia.</p>
          </section>
        )}
        <HowItWorks />
      </main>
      <footer>
        <p>
          Built on{" "}
          <a href="https://fhenix.io" target="_blank" rel="noreferrer">Fhenix CoFHE</a>
          {" | "}Arbitrum Sepolia{" | "}
          <a href={`https://sepolia.arbiscan.io/address/${addresses.BondAuction}`} target="_blank" rel="noreferrer">Contract</a>
        </p>
      </footer>
    </div>
  );
}
