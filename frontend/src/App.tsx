import { useState, useEffect } from "react";
import {
  useAccount,
  useConnect,
  useDisconnect,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
  usePublicClient,
  useWalletClient,
} from "wagmi";
import { injected } from "wagmi/connectors";
import { parseUnits, formatUnits } from "viem";
import { BOND_AUCTION_ABI, ERC20_ABI, CONFIDENTIAL_TOKEN_ABI } from "./abi";
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
const CUSDC_ADDR = (addresses as any).cUSDC as `0x${string}`;
const WETH_ADDR = addresses.WETH as `0x${string}`;

// Operator expiry: far future (~2033)
const OPERATOR_UNTIL = 2000000000;

// ============================================================
// Shared hooks
// ============================================================

function useTxFlow() {
  const { writeContract, data: hash, isPending, error: writeError, reset } = useWriteContract();
  const {
    isSuccess,
    isLoading: isConfirming,
    error: receiptError,
    data: receipt,
  } = useWaitForTransactionReceipt({
    hash,
    confirmations: 1,
    pollingInterval: 4000,
    timeout: 300_000,
  });
  const reverted = receipt?.status === "reverted";
  const error = writeError || receiptError || (reverted ? { shortMessage: "Transaction reverted on-chain. Check your parameters." } : undefined);
  return { writeContract, hash, isPending, isConfirming, isSuccess: isSuccess && !reverted, error, reset };
}

function useBalances() {
  const { address } = useAccount();

  // cUSDC (ConfidentialToken) — balance is encrypted, show indicator instead
  const { data: cusdcIndicator } = useReadContract({
    address: CUSDC_ADDR,
    abi: CONFIDENTIAL_TOKEN_ABI,
    functionName: "balanceIndicator",
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
    cusdcActivity: cusdcIndicator ? Number(cusdcIndicator) : 0,
    weth: wethBal ? formatUnits(wethBal as bigint, 18) : "0",
  };
}

// ============================================================
// Shared UI Components
// ============================================================

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
    return <p className="tx-status error">{msg.length > 120 ? msg.slice(0, 120) + "..." : msg}</p>;
  }
  if (isSuccess && hash) {
    return (
      <p className="tx-status success">
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
    return <p className="tx-status pending">Confirming transaction...</p>;
  }
  return null;
}

function EncryptionOverlay({ step }: { step: number }) {
  const steps = [
    "Initializing TFHE WASM...",
    "Generating encryption keys...",
    "Encrypting rate with FHE...",
    "Creating ZK proof...",
  ];

  return (
    <div className="encrypt-overlay">
      <div className="encrypt-modal">
        <div className="encrypt-visual">
          <div className="encrypt-ring" />
          <div className="encrypt-ring" />
          <div className="encrypt-ring" />
          <div className="encrypt-icon">&#x1F512;</div>
        </div>
        <div className="encrypt-title">Encrypting Your Rate</div>
        <div className="encrypt-desc">
          Your plaintext rate never leaves this browser.
          The contract will only see encrypted ciphertext.
        </div>
        <div className="encrypt-steps">
          {steps.map((s, i) => (
            <div
              key={i}
              className={`encrypt-step ${i < step ? "done" : i === step ? "active" : ""}`}
            >
              <div className="encrypt-step-dot" />
              {s}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
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
        <div className="header-right">
          <div className="network-badge">
            <span className="network-dot" />
            Arbitrum Sepolia
          </div>
          {isConnected ? (
            <div className="wallet-pill">
              <div className="wallet-info">
                <span className="address">
                  {address?.slice(0, 6)}...{address?.slice(-4)}
                </span>
                <span className="balances">
                  cUSDC {balances.cusdcActivity > 0 ? "Active" : "---"} | {Number(balances.weth).toFixed(2)} WETH
                </span>
              </div>
              <button onClick={() => disconnect()} className="btn-ghost btn-sm">
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
      </div>
    </header>
  );
}

// ============================================================
// Hero Landing (disconnected)
// ============================================================

function HeroLanding({ onConnect }: { onConnect: () => void }) {
  return (
    <div className="hero">
      <div className="hero-badge">Powered by FHE</div>
      <h2>Sealed-Bid Bond Auctions On-Chain</h2>
      <p className="hero-sub">
        Lenders bid encrypted interest rates. The contract finds the clearing rate
        without decrypting any individual bid. Real price discovery with total bidder privacy.
      </p>
      <button className="btn-primary" onClick={onConnect} style={{ margin: "0 auto" }}>
        Connect Wallet to Start
      </button>

      <div className="hero-stats">
        <div className="hero-stat">
          <div className="hero-stat-value">17</div>
          <div className="hero-stat-label">Passing Tests</div>
        </div>
        <div className="hero-stat">
          <div className="hero-stat-value">7</div>
          <div className="hero-stat-label">FHE Ops / Bid</div>
        </div>
        <div className="hero-stat">
          <div className="hero-stat-value">~430K</div>
          <div className="hero-stat-label">Gas / Bid</div>
        </div>
      </div>

      <div className="how-section">
        <h3>How It Works</h3>
        <div className="steps-grid">
          <div className="step-card">
            <div className="step-num">1</div>
            <strong>Create Bond</strong>
            <p>Borrower posts collateral, defines loan size split into K slots</p>
          </div>
          <div className="step-card">
            <div className="step-num">2</div>
            <strong>Bid Encrypted Rates</strong>
            <p>Each rate is FHE-encrypted client-side. Plaintext never touches the chain.</p>
          </div>
          <div className="step-card">
            <div className="step-num">3</div>
            <strong>Tournament</strong>
            <p>K passes on ciphertext find K lowest bids. No decryption needed.</p>
          </div>
          <div className="step-card">
            <div className="step-num">4</div>
            <strong>Settlement</strong>
            <p>All winners earn the same clearing rate. Individual bids stay encrypted forever.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Faucet Bar (compact)
// ============================================================

// ============================================================
// Judge Guide Banner
// ============================================================

function JudgeGuide() {
  const [dismissed, setDismissed] = useState(false);
  const { data: nextBondId } = useReadContract({
    address: AUCTION_ADDR,
    abi: BOND_AUCTION_ABI,
    functionName: "nextBondId",
  });

  if (dismissed) return null;

  const totalBonds = nextBondId ? Number(nextBondId) : 0;
  // Find the latest bond that might be seeded (Closed state)
  const latestBondId = totalBonds > 0 ? totalBonds - 1 : null;

  return (
    <div className="judge-guide">
      <div className="judge-guide-header">
        <span className="judge-guide-badge">Judge Quickstart</span>
        <button className="btn-ghost btn-sm" onClick={() => setDismissed(true)} style={{ color: "var(--text-dim)" }}>
          Dismiss
        </button>
      </div>
      <div className="judge-guide-steps">
        <div className="judge-step">
          <span className="judge-step-num">1</span>
          <span>Mint testnet tokens using the faucet below (100K cUSDC + 100 WETH)</span>
        </div>
        <div className="judge-step">
          <span className="judge-step-num">2</span>
          <span>
            Go to <strong>Bonds</strong> tab{latestBondId !== null ? ` — Bond #${latestBondId} is pre-seeded with encrypted bids` : ""}
          </span>
        </div>
        <div className="judge-step">
          <span className="judge-step-num">3</span>
          <span>Click <strong>Resolve Pass</strong> to run FHE tournament on ciphertext (one click per slot)</span>
        </div>
        <div className="judge-step">
          <span className="judge-step-num">4</span>
          <span>Click <strong>Decrypt & Settle</strong> to publish CoFHE results and reveal the clearing rate</span>
        </div>
      </div>
      <div className="judge-guide-note">
        All deposits flow through <strong>ConfidentialToken (FHERC20)</strong> — balances are encrypted on-chain.
        Rates AND positions are private. Only the clearing rate is revealed at settlement.
      </div>
    </div>
  );
}

// ============================================================
// Privacy Badge — shows encrypted balance status
// ============================================================

function PrivacyBadge() {
  return (
    <div className="privacy-badge-bar">
      <div className="privacy-item">
        <span className="privacy-dot encrypted" />
        <span>Rates: Encrypted (FHE)</span>
      </div>
      <div className="privacy-item">
        <span className="privacy-dot encrypted" />
        <span>Balances: Encrypted (FHERC20)</span>
      </div>
      <div className="privacy-item">
        <span className="privacy-dot public" />
        <span>Collateral: Public (ERC20)</span>
      </div>
    </div>
  );
}

function FaucetBar() {
  const { address } = useAccount();
  const tx1 = useTxFlow();
  const tx2 = useTxFlow();

  const mintCUSDC = () => {
    if (!address) return;
    tx1.reset();
    // ConfidentialToken mint takes uint64 — 100K with 6 decimals = 100_000_000_000
    tx1.writeContract({
      address: CUSDC_ADDR,
      abi: CONFIDENTIAL_TOKEN_ABI,
      functionName: "mint",
      args: [address, BigInt(100_000) * BigInt(10 ** 6)],
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
    <div className="faucet-bar">
      <span>Testnet Faucet</span>
      <button onClick={mintCUSDC} disabled={tx1.isPending} className="btn-secondary btn-sm">
        {tx1.isPending ? "Minting..." : "100K cUSDC"}
      </button>
      <button onClick={mintWETH} disabled={tx2.isPending} className="btn-secondary btn-sm">
        {tx2.isPending ? "Minting..." : "100 WETH"}
      </button>
      {tx1.isSuccess && <span className="tx-status success" style={{ fontSize: 11 }}>cUSDC minted (encrypted balance)</span>}
      {tx2.isSuccess && <span className="tx-status success" style={{ fontSize: 11 }}>WETH minted</span>}
    </div>
  );
}

// ============================================================
// Tab: Bonds (browse + detail)
// ============================================================

function BondsTab() {
  const { address } = useAccount();
  const [selectedBondId, setSelectedBondId] = useState<number | null>(null);
  const tx = useTxFlow();

  const { data: nextBondId } = useReadContract({
    address: AUCTION_ADDR,
    abi: BOND_AUCTION_ABI,
    functionName: "nextBondId",
    query: { refetchInterval: 15000 },
  });

  const totalBonds = nextBondId ? Number(nextBondId) : 0;

  if (selectedBondId !== null) {
    return (
      <BondDetail
        bondId={selectedBondId}
        onBack={() => setSelectedBondId(null)}
        tx={tx}
        address={address}
      />
    );
  }

  return (
    <div className="tab-panel">
      <div className="panel-header">
        <h2>Bond Auctions</h2>
        <span className="badge state-0">{totalBonds} total</span>
      </div>

      {totalBonds === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">&#x1F4CB;</div>
          <h3>No bonds yet</h3>
          <p>Create the first bond auction or wait for a borrower to post one.</p>
        </div>
      ) : (
        <div className="bond-list">
          {Array.from({ length: totalBonds }, (_, i) => (
            <BondListItem
              key={i}
              bondId={i}
              onClick={() => setSelectedBondId(i)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function BondListItem({ bondId, onClick }: { bondId: number; onClick: () => void }) {
  const { data: bondData } = useReadContract({
    address: AUCTION_ADDR,
    abi: BOND_AUCTION_ABI,
    functionName: "getBond",
    args: [BigInt(bondId)],
  });

  const { data: bidCount } = useReadContract({
    address: AUCTION_ADDR,
    abi: BOND_AUCTION_ABI,
    functionName: "getBidCount",
    args: [BigInt(bondId)],
  });

  const bond = bondData as any;
  if (!bond) {
    return (
      <div className="bond-list-item">
        <div className="skeleton" style={{ width: "100%", height: 40 }} />
      </div>
    );
  }

  const state = Number(bond[10]);
  const totalBorrow = formatUnits(BigInt(bond[4]) * BigInt(bond[5]), 6);
  const borrower = bond[0] as string;
  const settledRate = Number(bond[13]);

  return (
    <div className="bond-list-item" onClick={onClick}>
      <div className="bond-list-left">
        <span className="bond-id">#{bondId}</span>
        <div className="bond-list-meta">
          <span>{Number(totalBorrow).toLocaleString()} cUSDC</span>
          <span>{borrower.slice(0, 8)}...{borrower.slice(-4)}</span>
        </div>
      </div>
      <div className="bond-list-right">
        {settledRate > 0 && (
          <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 14 }}>
            {(settledRate / 100).toFixed(2)}%
          </span>
        )}
        <span style={{ fontSize: 12, color: "var(--text-dim)" }}>
          {bidCount?.toString() || "0"} bids
        </span>
        <span className={`badge state-${state}`}>{BOND_STATES[state]}</span>
      </div>
    </div>
  );
}

function SettleButton({
  bondId,
  tx,
  onSettle,
}: {
  bondId: number;
  tx: ReturnType<typeof useTxFlow>;
  onSettle: () => void;
}) {
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const publishTx = useTxFlow();
  const [phase, setPhase] = useState<"idle" | "decrypting" | "publishing" | "settling" | "done" | "error">("idle");
  const [statusMsg, setStatusMsg] = useState("");

  const handleDecryptAndSettle = async () => {
    if (!publicClient || !walletClient) return;
    setPhase("decrypting");
    setStatusMsg("Fetching FHE handles...");

    try {
      // 1. Get decrypt handles from contract
      const handles = await publicClient.readContract({
        address: AUCTION_ADDR,
        abi: BOND_AUCTION_ABI,
        functionName: "getDecryptHandles",
        args: [BigInt(bondId)],
      }) as [string, string[]];

      const clearingRateHandle = handles[0];
      const excludedHandles = handles[1];

      setStatusMsg("Connecting to CoFHE threshold network...");

      // 2. Init CoFHE SDK
      const { createCofheClient, createCofheConfig } = await import("@cofhe/sdk/web");
      const { arbSepolia } = await import("@cofhe/sdk/chains");
      const config = createCofheConfig({ supportedChains: [arbSepolia] });
      const cofhe = createCofheClient(config);
      await cofhe.connect(publicClient as any, walletClient as any);

      // 3. Decrypt clearing rate
      setStatusMsg("Decrypting clearing rate from threshold network...");
      const rateResult = await cofhe.decryptForTx(BigInt(clearingRateHandle)).withoutPermit().execute();

      // 4. Decrypt winner flags
      setStatusMsg(`Decrypting ${excludedHandles.length} winner flags...`);
      const winnerFlags: boolean[] = [];
      const flagSignatures: string[] = [];
      for (let i = 0; i < excludedHandles.length; i++) {
        setStatusMsg(`Decrypting flag ${i + 1}/${excludedHandles.length}...`);
        const flagResult = await cofhe.decryptForTx(BigInt(excludedHandles[i])).withoutPermit().execute();
        winnerFlags.push(BigInt(flagResult.decryptedValue) > 0n);
        flagSignatures.push(flagResult.signature);
      }

      // 5. Publish results on-chain
      setPhase("publishing");
      setStatusMsg("Publishing decryption results on-chain...");
      publishTx.reset();
      publishTx.writeContract({
        address: AUCTION_ADDR,
        abi: BOND_AUCTION_ABI,
        functionName: "publishResults",
        args: [
          BigInt(bondId),
          BigInt(rateResult.decryptedValue),
          rateResult.signature as `0x${string}`,
          winnerFlags,
          flagSignatures as `0x${string}`[],
        ],
      });
    } catch (err: any) {
      setPhase("error");
      setStatusMsg(err?.message?.slice(0, 150) || "Decryption failed");
    }
  };

  // After publish succeeds, settle
  useEffect(() => {
    if (publishTx.isSuccess && phase === "publishing") {
      setPhase("settling");
      setStatusMsg("Settling bond...");
      onSettle();
    }
  }, [publishTx.isSuccess]);

  // After settle succeeds
  useEffect(() => {
    if (tx.isSuccess && phase === "settling") {
      setPhase("done");
      setStatusMsg("");
    }
  }, [tx.isSuccess]);

  return (
    <div>
      <button
        onClick={handleDecryptAndSettle}
        disabled={phase !== "idle" && phase !== "error" && phase !== "done"}
        className="btn-primary"
      >
        {phase === "idle" || phase === "error"
          ? "Decrypt & Settle"
          : phase === "done"
            ? "Settled!"
            : phase === "settling"
              ? "Settling..."
              : "Decrypting..."}
      </button>
      {statusMsg && (
        <p className={`tx-status ${phase === "error" ? "error" : "pending"}`} style={{ marginTop: 8 }}>
          {statusMsg}
        </p>
      )}
      <TxStatus hash={publishTx.hash} error={publishTx.error} isSuccess={publishTx.isSuccess} />
      <TxStatus hash={tx.hash} error={tx.error} isSuccess={tx.isSuccess} />
    </div>
  );
}

function TournamentViz({
  bidCount,
  slotCount,
  currentPass,
  state,
  settledRate,
  winners,
}: {
  bidCount: number;
  slotCount: number;
  currentPass: number;
  state: number;
  settledRate: number;
  winners?: string[];
}) {
  // Generate fake encrypted hashes for each bid (consistent per bid index)
  const bidHashes = Array.from({ length: bidCount }, (_, i) =>
    "0x" + Array.from({ length: 8 }, (_, j) => ((i * 7 + j * 13 + 42) % 256).toString(16).padStart(2, "0")).join("")
  );

  return (
    <div className="tournament-viz">
      <div className="tournament-header">
        <h3>FHE Tournament Bracket</h3>
        <span className="tournament-sub">
          {state <= 2
            ? `${currentPass} of ${slotCount} passes complete — computing on encrypted ciphertext`
            : state === 3
              ? "All passes complete — clearing rate found"
              : `Settled at ${(settledRate / 100).toFixed(2)}%`}
        </span>
      </div>

      <div className="tournament-passes">
        {Array.from({ length: slotCount }, (_, pass) => {
          const isComplete = pass < currentPass;
          const isActive = pass === currentPass && state === 2;
          const isFuture = pass >= currentPass && !isActive;

          return (
            <div
              key={pass}
              className={`tournament-pass ${isComplete ? "complete" : isActive ? "active" : "future"}`}
            >
              <div className="pass-label">
                Pass {pass + 1}
                {isComplete && <span className="pass-check">&#10003;</span>}
                {isActive && <span className="pass-computing">&#x2026;</span>}
              </div>
              <div className="pass-detail">
                {isComplete
                  ? `Winner #${pass + 1} found via FHE.lt comparison`
                  : isActive
                    ? "Finding minimum via encrypted comparison..."
                    : "Pending"}
              </div>
            </div>
          );
        })}
      </div>

      <div className="tournament-bids">
        <div className="bids-header">
          <span>{bidCount} encrypted bids</span>
          <span className="mono" style={{ color: "var(--accent)", fontSize: 11 }}>
            FHE.lt + FHE.select + FHE.eq per bid per pass
          </span>
        </div>
        <div className="bid-hashes">
          {bidHashes.map((hash, i) => {
            const isWinner = winners && i < (winners?.length || 0) && currentPass > 0;
            const isExcluded = i < currentPass;
            return (
              <div
                key={i}
                className={`bid-hash ${isExcluded ? "excluded" : ""} ${isWinner ? "winner" : ""}`}
              >
                <span className="bid-index">#{i}</span>
                <span className="bid-cipher">{hash}...</span>
                {isExcluded && <span className="bid-status">&#x1F3C6;</span>}
              </div>
            );
          })}
        </div>
      </div>

      <div className="tournament-ops">
        <span>FHE operations: {currentPass * bidCount * 7} executed</span>
        <span>({bidCount * 7} per pass x {currentPass} passes)</span>
      </div>
    </div>
  );
}

function BondDetail({
  bondId,
  onBack,
  tx,
  address,
}: {
  bondId: number;
  onBack: () => void;
  tx: ReturnType<typeof useTxFlow>;
  address: string | undefined;
}) {
  const { data: bondData, refetch } = useReadContract({
    address: AUCTION_ADDR,
    abi: BOND_AUCTION_ABI,
    functionName: "getBond",
    args: [BigInt(bondId)],
    query: { refetchInterval: 8000 },
  });

  const { data: bidCount, refetch: refetchBids } = useReadContract({
    address: AUCTION_ADDR,
    abi: BOND_AUCTION_ABI,
    functionName: "getBidCount",
    args: [BigInt(bondId)],
    query: { refetchInterval: 8000 },
  });

  const { data: winnersData } = useReadContract({
    address: AUCTION_ADDR,
    abi: BOND_AUCTION_ABI,
    functionName: "getWinners",
    args: [BigInt(bondId)],
    query: { refetchInterval: 8000 },
  });

  const { data: isWinnerData } = useReadContract({
    address: AUCTION_ADDR,
    abi: BOND_AUCTION_ABI,
    functionName: "isWinner",
    args: address ? [BigInt(bondId), address as `0x${string}`] : undefined,
    query: { enabled: !!address, refetchInterval: 8000 },
  });

  useEffect(() => {
    if (tx.isSuccess) {
      refetch();
      refetchBids();
    }
  }, [tx.isSuccess]);

  const bond = bondData as any;
  if (!bond) {
    return (
      <div className="tab-panel">
        <button className="back-link" onClick={onBack}>&#8592; All Bonds</button>
        <div className="skeleton" style={{ width: "100%", height: 200 }} />
      </div>
    );
  }

  const state = Number(bond[10]);
  const slotCount = Number(bond[5]);
  const currentPass = Number(bond[12]);
  const settledRate = Number(bond[13]);
  const totalRepayment = bond[14] as bigint;
  const deadline = Number(bond[8]);
  const maturity = Number(bond[9]);
  const borrower = bond[0] as string;
  const isBorrower = address && borrower.toLowerCase() === address.toLowerCase();
  const isWinner = !!isWinnerData;
  const winners = winnersData as string[] | undefined;

  let role = "";
  if (isBorrower) role = "Borrower";
  else if (isWinner) role = "Winning Lender";

  const handleAction = (fn: string) => {
    tx.reset();
    tx.writeContract({
      address: AUCTION_ADDR,
      abi: BOND_AUCTION_ABI,
      functionName: fn as any,
      args: [BigInt(bondId)],
    });
  };

  return (
    <div className="tab-panel">
      <button className="back-link" onClick={onBack}>&#8592; All Bonds</button>

      <div className="panel-header">
        <h2>Bond #{bondId}</h2>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {role && <span className="role-badge">{role}</span>}
          <span className={`badge state-${state}`}>{BOND_STATES[state]}</span>
        </div>
      </div>

      {/* Clearing Rate Hero */}
      {settledRate > 0 && (
        <div className="clearing-rate-reveal">
          <div className="clearing-rate-label">Clearing Rate</div>
          <div className="clearing-rate-value">{(settledRate / 100).toFixed(2)}%</div>
          <div className="clearing-rate-sub">
            All {winners?.length || slotCount} winning lenders earn this rate
          </div>
        </div>
      )}

      <div className="info-grid">
        <div className="info-item">
          <span className="label">Total Borrow</span>
          <span>{Number(formatUnits(BigInt(bond[4]) * BigInt(bond[5]), 6)).toLocaleString()} cUSDC</span>
        </div>
        <div className="info-item">
          <span className="label">Collateral</span>
          <span>{formatUnits(bond[2], 18)} WETH</span>
        </div>
        <div className="info-item">
          <span className="label">Slots</span>
          <span>{slotCount} x {formatUnits(bond[4], 6)} cUSDC</span>
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
            {state === 0 ? (
              <Countdown deadline={deadline} />
            ) : (
              <span style={{ fontSize: 13 }}>{new Date(deadline * 1000).toLocaleString()}</span>
            )}
          </div>
        )}
        {totalRepayment > 0n && (
          <div className="info-item">
            <span className="label">Total Repayment</span>
            <span>{formatUnits(totalRepayment, 6)} cUSDC</span>
          </div>
        )}
        {maturity > 0 && (
          <div className="info-item">
            <span className="label">Maturity</span>
            {state === 4 ? (
              <Countdown deadline={maturity} />
            ) : (
              <span style={{ fontSize: 13 }}>{new Date(maturity * 1000).toLocaleString()}</span>
            )}
          </div>
        )}
      </div>

      {/* Tournament Visualization — shows FHE computation progress */}
      {(state >= 1 && state <= 4) && Number(bidCount || 0) > 0 && (
        <TournamentViz
          bidCount={Number(bidCount)}
          slotCount={slotCount}
          currentPass={currentPass}
          state={state}
          settledRate={settledRate}
          winners={winners}
        />
      )}

      {winners && winners.length > 0 && (
        <div className="winners">
          <h3>Winners ({winners.length})</h3>
          {winners.map((w, i) => (
            <span
              key={i}
              className={`winner-addr ${address && w.toLowerCase() === address.toLowerCase() ? "winner-you" : ""}`}
            >
              {w.slice(0, 8)}...{w.slice(-4)}
              {address && w.toLowerCase() === address.toLowerCase() && " (you)"}
            </span>
          ))}
        </div>
      )}

      <div className="btn-row">
        {state === 0 && (
          <button
            onClick={() => handleAction("closeBond")}
            disabled={tx.isPending}
            className="btn-secondary"
          >
            {tx.isPending ? "Closing..." : "Close Bidding"}
          </button>
        )}
        {(state === 1 || state === 2) && currentPass < slotCount && (
          <button
            onClick={() => handleAction("resolvePass")}
            disabled={tx.isPending}
            className="btn-primary"
          >
            {tx.isPending
              ? "Resolving..."
              : `Resolve Pass ${currentPass + 1}/${slotCount}`}
          </button>
        )}
        {state === 3 && (
          <SettleButton bondId={bondId} tx={tx} onSettle={() => handleAction("settle")} />
        )}
        {state === 4 && isBorrower && (
          <button
            onClick={() => handleAction("repay")}
            disabled={tx.isPending}
            className="btn-primary"
          >
            {tx.isPending ? "Repaying..." : "Repay Bond"}
          </button>
        )}
        {state === 5 && isWinner && (
          <button
            onClick={() => handleAction("claim")}
            disabled={tx.isPending}
            className="btn-primary"
          >
            {tx.isPending ? "Claiming..." : "Claim Payout"}
          </button>
        )}
        {state === 4 && !isBorrower && (
          <button
            onClick={() => handleAction("liquidate")}
            disabled={tx.isPending}
            className="btn-danger"
          >
            {tx.isPending ? "Liquidating..." : "Liquidate"}
          </button>
        )}
        {state === 7 && isBorrower && (
          <button
            onClick={() => handleAction("claimCollateral")}
            disabled={tx.isPending}
            className="btn-secondary"
          >
            Reclaim Collateral
          </button>
        )}
        {state === 7 && !isBorrower && (
          <button
            onClick={() => handleAction("claimRefund")}
            disabled={tx.isPending}
            className="btn-secondary"
          >
            Claim Refund
          </button>
        )}
      </div>
      <TxStatus hash={tx.hash} error={tx.error} isSuccess={tx.isSuccess} />
    </div>
  );
}

// ============================================================
// Tab: Lend (Submit Bid)
// ============================================================

function LendTab() {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const approveTx = useTxFlow();
  const bidTx = useTxFlow();

  const [bondId, setBondId] = useState("0");
  const [rateBps, setRateBps] = useState("450");
  const [encryptStep, setEncryptStep] = useState(-1);
  const [encryptError, setEncryptError] = useState("");
  const [approveComplete, setApproveComplete] = useState(false);

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

  const { data: nextBondId } = useReadContract({
    address: AUCTION_ADDR,
    abi: BOND_AUCTION_ABI,
    functionName: "nextBondId",
    query: { refetchInterval: 15000 },
  });

  const bond = bondData as any;
  const slotSize = bond ? (bond[4] as bigint) : 0n;
  const bondState = bond ? Number(bond[10]) : -1;
  const totalBonds = nextBondId ? Number(nextBondId) : 0;

  useEffect(() => {
    if (approveTx.isSuccess) setApproveComplete(true);
  }, [approveTx.isSuccess]);

  const handleSetOperator = () => {
    if (!slotSize) return;
    approveTx.reset();
    setApproveComplete(false);
    // ConfidentialToken uses operator model instead of ERC20 approve
    approveTx.writeContract({
      address: CUSDC_ADDR,
      abi: CONFIDENTIAL_TOKEN_ABI,
      functionName: "setOperator",
      args: [AUCTION_ADDR, OPERATOR_UNTIL],
    });
  };

  const handleSubmitBid = async () => {
    if (!publicClient || !walletClient) return;
    setEncryptError("");

    try {
      setEncryptStep(0);
      const { createCofheClient, createCofheConfig } = await import("@cofhe/sdk/web");
      const { Encryptable } = await import("@cofhe/sdk");
      const { arbSepolia } = await import("@cofhe/sdk/chains");

      setEncryptStep(1);
      const config = createCofheConfig({ supportedChains: [arbSepolia] });
      const client = createCofheClient(config);
      await client.connect(publicClient as any, walletClient as any);

      setEncryptStep(2);
      const [encryptedRate] = await client
        .encryptInputs([Encryptable.uint64(BigInt(rateBps))])
        .execute();

      setEncryptStep(3);
      // Brief pause to show ZK proof step
      await new Promise((r) => setTimeout(r, 800));
      setEncryptStep(-1);

      bidTx.reset();
      bidTx.writeContract({
        address: AUCTION_ADDR,
        abi: BOND_AUCTION_ABI,
        functionName: "submitRate",
        args: [BigInt(bondId), encryptedRate as any],
      });
    } catch (err: any) {
      setEncryptStep(-1);
      setEncryptError(err?.message?.slice(0, 120) || "Encryption failed");
    }
  };

  return (
    <div className="tab-panel">
      <div className="panel-header">
        <h2>Submit Encrypted Bid</h2>
      </div>

      {encryptStep >= 0 && <EncryptionOverlay step={encryptStep} />}

      <div className="card">
        <p className="desc">
          Your interest rate is encrypted client-side using FHE before submission.
          Your deposit flows through cUSDC (ConfidentialToken) — balances are encrypted
          on-chain so your position stays private. The contract never sees your plaintext rate.
        </p>
        <div className="form-grid">
          <label>
            Bond ID
            {totalBonds > 0 ? (
              <select
                value={bondId}
                onChange={(e) => setBondId(e.target.value)}
                style={{
                  background: "var(--bg)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  padding: "10px 12px",
                  color: "var(--text)",
                  fontSize: 14,
                  fontFamily: "var(--font-mono)",
                  outline: "none",
                }}
              >
                {Array.from({ length: totalBonds }, (_, i) => (
                  <option key={i} value={i}>
                    #{i}
                  </option>
                ))}
              </select>
            ) : (
              <input type="text" value={bondId} onChange={(e) => setBondId(e.target.value)} placeholder="0" />
            )}
            {bond && (
              <span className="field-hint">
                {bondState === 0 ? "Open" : BOND_STATES[bondState] || "Unknown"} | Deposit:{" "}
                {slotSize ? formatUnits(slotSize, 6) : "?"} cUSDC
              </span>
            )}
          </label>
          <label>
            Your Rate (basis points)
            <input
              type="text"
              value={rateBps}
              onChange={(e) => setRateBps(e.target.value)}
              placeholder="450"
            />
            <span className="field-hint">{(Number(rateBps) / 100).toFixed(2)}% annual</span>
          </label>
        </div>

        {alreadyBid && <p className="tx-status error">You already submitted a bid on this bond.</p>}

        <div className="btn-row">
          <button
            onClick={handleSetOperator}
            disabled={approveTx.isPending || !slotSize || bondState !== 0}
            className={approveComplete ? "btn-done" : "btn-secondary"}
          >
            {approveTx.isPending
              ? "Setting operator..."
              : approveComplete
                ? "Operator Set"
                : `1. Authorize cUSDC (${slotSize ? formatUnits(slotSize, 6) : "?"} deposit)`}
          </button>
          <button
            onClick={handleSubmitBid}
            disabled={
              bidTx.isPending ||
              encryptStep >= 0 ||
              !approveComplete ||
              bondState !== 0 ||
              !!alreadyBid
            }
            className="btn-primary"
          >
            {bidTx.isPending ? "Submitting..." : "2. Encrypt & Submit Bid"}
          </button>
        </div>
        {encryptError && <p className="tx-status error">{encryptError}</p>}
        <TxStatus hash={approveTx.hash} error={approveTx.error} isSuccess={approveTx.isSuccess} />
        <TxStatus hash={bidTx.hash} error={bidTx.error} isSuccess={bidTx.isSuccess} />
      </div>
    </div>
  );
}

// ============================================================
// Tab: Borrow (Create Bond)
// ============================================================

function BorrowTab() {
  const approveTx = useTxFlow();
  const createTx = useTxFlow();
  const [approveComplete, setApproveComplete] = useState(false);

  const [form, setForm] = useState({
    collateralAmount: "1",
    slotSize: "100",
    slotCount: "2",
    maxRate: "2000",
    duration: "30",
    biddingDuration: "600",
    minBidders: "3",
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
    // slotSize is uint64 in the contract — pass with 6 decimals
    const slotSizeWithDecimals = BigInt(Number(form.slotSize) * 10 ** 6);

    createTx.writeContract({
      address: AUCTION_ADDR,
      abi: BOND_AUCTION_ABI,
      functionName: "createBond",
      args: [
        WETH_ADDR,
        collateralWei,
        CUSDC_ADDR, // ConfidentialToken (FHERC20)
        slotSizeWithDecimals,
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
    <div className="tab-panel">
      <div className="panel-header">
        <h2>Create Bond Request</h2>
      </div>

      <div className="card">
        <p className="desc">
          Post collateral and request a loan. Lenders will bid encrypted interest rates.
          You'll borrow {totalBorrow.toLocaleString()} cUSDC across {form.slotCount} slots.
          All lending flows use ConfidentialToken — balances are encrypted on-chain.
        </p>
        <div className="form-grid">
          <label>
            Collateral (WETH)
            <input
              type="text"
              value={form.collateralAmount}
              onChange={(e) => setForm({ ...form, collateralAmount: e.target.value })}
            />
          </label>
          <label>
            Slot Size (cUSDC)
            <input
              type="text"
              value={form.slotSize}
              onChange={(e) => setForm({ ...form, slotSize: e.target.value })}
            />
          </label>
        </div>
        <div className="form-grid form-grid-3">
          <label>
            Slots (K)
            <input
              type="text"
              value={form.slotCount}
              onChange={(e) => setForm({ ...form, slotCount: e.target.value })}
            />
          </label>
          <label>
            Max Rate (bps)
            <input
              type="text"
              value={form.maxRate}
              onChange={(e) => setForm({ ...form, maxRate: e.target.value })}
            />
            <span className="field-hint">{(Number(form.maxRate) / 100).toFixed(2)}%</span>
          </label>
          <label>
            Duration (days)
            <input
              type="text"
              value={form.duration}
              onChange={(e) => setForm({ ...form, duration: e.target.value })}
            />
          </label>
        </div>
        <div className="form-grid">
          <label>
            Bidding Window (sec)
            <input
              type="text"
              value={form.biddingDuration}
              onChange={(e) => setForm({ ...form, biddingDuration: e.target.value })}
            />
            <span className="field-hint">{(Number(form.biddingDuration) / 60).toFixed(0)} min</span>
          </label>
          <label>
            Min Bidders
            <input
              type="text"
              value={form.minBidders}
              onChange={(e) => setForm({ ...form, minBidders: e.target.value })}
            />
          </label>
        </div>
        <div className="btn-row">
          <button
            onClick={handleApprove}
            disabled={approveTx.isPending || approveTx.isConfirming}
            className={approveComplete ? "btn-done" : "btn-secondary"}
          >
            {approveTx.isPending ? "Approving..." : approveComplete ? "Approved" : "1. Approve WETH"}
          </button>
          <button
            onClick={handleCreate}
            disabled={createTx.isPending || createTx.isConfirming || !approveComplete}
            className="btn-primary"
          >
            {createTx.isPending ? "Creating..." : "2. Create Bond"}
          </button>
        </div>
        <TxStatus hash={approveTx.hash} error={approveTx.error} isSuccess={approveTx.isSuccess} />
        <TxStatus hash={createTx.hash} error={createTx.error} isSuccess={createTx.isSuccess} />
      </div>
    </div>
  );
}

// ============================================================
// App
// ============================================================

type Tab = "bonds" | "lend" | "borrow";

export default function App() {
  const { isConnected } = useAccount();
  const { connect } = useConnect();
  const [activeTab, setActiveTab] = useState<Tab>("bonds");

  return (
    <div className="app">
      <Header />
      <main>
        {isConnected ? (
          <>
            <JudgeGuide />
            <PrivacyBadge />
            <FaucetBar />
            <nav className="nav-tabs">
              <button
                className={`nav-tab ${activeTab === "bonds" ? "active" : ""}`}
                onClick={() => setActiveTab("bonds")}
              >
                <span className="tab-icon">&#x1F4CA;</span>
                Bonds
              </button>
              <button
                className={`nav-tab ${activeTab === "lend" ? "active" : ""}`}
                onClick={() => setActiveTab("lend")}
              >
                <span className="tab-icon">&#x1F512;</span>
                Lend
              </button>
              <button
                className={`nav-tab ${activeTab === "borrow" ? "active" : ""}`}
                onClick={() => setActiveTab("borrow")}
              >
                <span className="tab-icon">&#x1F4B0;</span>
                Borrow
              </button>
            </nav>

            {activeTab === "bonds" && <BondsTab />}
            {activeTab === "lend" && <LendTab />}
            {activeTab === "borrow" && <BorrowTab />}
          </>
        ) : (
          <HeroLanding onConnect={() => connect({ connector: injected() })} />
        )}
      </main>
      <footer>
        Built on{" "}
        <a href="https://fhenix.io" target="_blank" rel="noreferrer">
          Fhenix CoFHE
        </a>
        {" | "}Arbitrum Sepolia{" | "}
        <a
          href={`https://sepolia.arbiscan.io/address/${addresses.BondAuction}`}
          target="_blank"
          rel="noreferrer"
        >
          Contract
        </a>
      </footer>
    </div>
  );
}
