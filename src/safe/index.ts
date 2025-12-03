// eslint-disable-next-line @typescript-eslint/no-var-requires
import SafeApiKitModule from "@safe-global/api-kit";

// The Safe API Kit has ESM/CJS interop issues with TypeScript
const SafeApiKit = SafeApiKitModule as unknown as new (config: { chainId: bigint; apiKey: string }) => {
  getSafeInfo: (address: string) => Promise<{ owners: string[]; threshold: number; nonce: number }>;
  getPendingTransactions: (address: string) => Promise<{ results: Array<{
    safeTxHash: string;
    to?: string | null;
    value: string;
    data?: string | null;
    confirmations?: Array<{ owner: string }> | null;
    confirmationsRequired: number;
    submissionDate: string;
  }> }>;
  getMultisigTransactions: (address: string) => Promise<{ results: Array<{
    transactionHash?: string | null;
    to?: string | null;
    value: string;
    executionDate?: string | null;
    isSuccessful?: boolean | null;
    isExecuted?: boolean;
  }> }>;
};
import { createPublicClient, http, formatEther, type Chain } from "viem";
import { mainnet, sepolia, polygon, arbitrum, optimism, base } from "viem/chains";
import {
  config,
  SAFE_TX_SERVICE_URLS,
  getSafeTxUrl,
} from "../config.js";

// Chain mapping for viem
const CHAINS: Record<number, Chain> = {
  1: mainnet,
  11155111: sepolia,
  137: polygon,
  42161: arbitrum,
  10: optimism,
  8453: base,
};

// Initialize viem public client
const chain = CHAINS[config.ethereum.chainId] || mainnet;
export const publicClient = createPublicClient({
  chain,
  transport: http(config.ethereum.rpcUrl),
});

// Initialize Safe API Kit
const txServiceUrl = SAFE_TX_SERVICE_URLS[config.ethereum.chainId];
if (!txServiceUrl) {
  throw new Error(
    `Unsupported chain ID for Safe Transaction Service: ${config.ethereum.chainId}`
  );
}

export const safeApiKit = new SafeApiKit({
  chainId: BigInt(config.ethereum.chainId),
  apiKey: config.safe.apiKey,
});

export interface SafeInfo {
  address: string;
  owners: string[];
  threshold: number;
  balance: string;
  balanceWei: bigint;
  nonce: number;
}

export async function getSafeInfo(): Promise<SafeInfo> {
  const safeAddress = config.safe.address as `0x${string}`;

  // Get Safe info from API
  const safeInfo = await safeApiKit.getSafeInfo(safeAddress);

  // Get balance from chain
  const balanceWei = await publicClient.getBalance({
    address: safeAddress,
  });

  return {
    address: safeAddress,
    owners: safeInfo.owners,
    threshold: safeInfo.threshold,
    balance: formatEther(balanceWei),
    balanceWei,
    nonce: safeInfo.nonce,
  };
}

export interface PendingTransaction {
  safeTxHash: string;
  to: string;
  value: string;
  valueEth: string;
  data: string;
  confirmations: number;
  confirmationsRequired: number;
  submissionDate: string;
  confirmingOwners: string[];
  signingUrl: string;
}

export async function getPendingTransactions(): Promise<PendingTransaction[]> {
  const safeAddress = config.safe.address;

  const pendingTxs = await safeApiKit.getPendingTransactions(safeAddress);

  return pendingTxs.results.map((tx: {
    safeTxHash: string;
    to?: string | null;
    value: string;
    data?: string | null;
    confirmations?: Array<{ owner: string }> | null;
    confirmationsRequired: number;
    submissionDate: string;
  }) => ({
    safeTxHash: tx.safeTxHash,
    to: tx.to || "",
    value: tx.value,
    valueEth: formatEther(BigInt(tx.value)),
    data: tx.data || "0x",
    confirmations: tx.confirmations?.length || 0,
    confirmationsRequired: tx.confirmationsRequired,
    submissionDate: tx.submissionDate,
    confirmingOwners: tx.confirmations?.map((c) => c.owner) || [],
    signingUrl: getSafeTxUrl(
      safeAddress,
      tx.safeTxHash,
      config.ethereum.chainId
    ),
  }));
}

export interface TransactionHistory {
  txHash: string;
  to: string;
  value: string;
  valueEth: string;
  executionDate: string;
  isSuccessful: boolean;
}

export async function getTransactionHistory(
  limit = 10
): Promise<TransactionHistory[]> {
  const safeAddress = config.safe.address;

  const history = await safeApiKit.getMultisigTransactions(safeAddress);

  return history.results
    .filter((tx: { isExecuted?: boolean }) => tx.isExecuted)
    .slice(0, limit)
    .map((tx: {
      transactionHash?: string | null;
      to?: string | null;
      value: string;
      executionDate?: string | null;
      isSuccessful?: boolean | null;
    }) => ({
      txHash: tx.transactionHash || "",
      to: tx.to || "",
      value: tx.value,
      valueEth: formatEther(BigInt(tx.value)),
      executionDate: tx.executionDate || "",
      isSuccessful: tx.isSuccessful || false,
    }));
}

// Note: To propose a transaction, users need to sign it with their wallet
// The bot will generate a deep link to the Safe app for signing
export function generateProposalInstructions(
  toAddress: string,
  amountEth: string
): string {
  const safeAddress = config.safe.address;
  const chainId = config.ethereum.chainId;

  // Generate Safe app URL for new transaction
  const safeAppUrl = `https://app.safe.global/new-transaction/send?safe=${
    chainId === 1 ? "eth" : chainId === 137 ? "matic" : chainId === 42161 ? "arb1" : chainId === 8453 ? "base" : "sep"
  }:${safeAddress}`;

  return (
    `To propose this transaction:\n\n` +
    `1. Open the Safe app: ${safeAppUrl}\n` +
    `2. Click "New Transaction" → "Send tokens"\n` +
    `3. Enter recipient: ${toAddress}\n` +
    `4. Enter amount: ${amountEth} ETH\n` +
    `5. Sign with your wallet\n\n` +
    `Once proposed, the other signer(s) can approve via the link I'll share.`
  );
}

// Watch for incoming transactions to the Safe
export async function getRecentIncomingTransfers(
  fromBlock?: bigint
): Promise<
  Array<{
    hash: string;
    from: string;
    value: string;
    valueEth: string;
    blockNumber: bigint;
  }>
> {
  const safeAddress = config.safe.address as `0x${string}`;

  // Get latest block if not specified
  const latestBlock = await publicClient.getBlockNumber();

  // For ETH transfers, we need to check transactions directly
  // This is a simplified version - production would use indexed events
  const block = await publicClient.getBlock({
    blockNumber: latestBlock,
    includeTransactions: true,
  });

  const incomingTxs = block.transactions
    .filter(
      (tx) =>
        typeof tx !== "string" &&
        tx.to?.toLowerCase() === safeAddress.toLowerCase() &&
        tx.value > 0n
    )
    .map((tx) => {
      if (typeof tx === "string") throw new Error("Unexpected string tx");
      return {
        hash: tx.hash,
        from: tx.from,
        value: tx.value.toString(),
        valueEth: formatEther(tx.value),
        blockNumber: tx.blockNumber || 0n,
      };
    });

  return incomingTxs;
}

export function formatAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}
