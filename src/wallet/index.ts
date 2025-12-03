import {
  createPublicClient,
  createWalletClient,
  http,
  formatEther,
  parseEther,
  type Chain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mainnet, sepolia, polygon, arbitrum, optimism, base } from "viem/chains";
import { config } from "../config.js";

// Chain mapping
const CHAINS: Record<number, Chain> = {
  1: mainnet,
  11155111: sepolia,
  137: polygon,
  42161: arbitrum,
  10: optimism,
  8453: base,
};

const chain = CHAINS[config.ethereum.chainId] || mainnet;

// Create account from private key
const account = privateKeyToAccount(config.wallet.privateKey as `0x${string}`);

// Public client for reading
export const publicClient = createPublicClient({
  chain,
  transport: http(config.ethereum.rpcUrl),
});

// Wallet client for signing/sending
export const walletClient = createWalletClient({
  account,
  chain,
  transport: http(config.ethereum.rpcUrl),
});

// Get wallet address
export function getWalletAddress(): string {
  return account.address;
}

// Get wallet balance
export async function getBalance(): Promise<{ wei: bigint; eth: string }> {
  const balance = await publicClient.getBalance({
    address: account.address,
  });

  return {
    wei: balance,
    eth: formatEther(balance),
  };
}

// Send ETH transaction
export async function sendTransaction(
  to: string,
  amountEth: string
): Promise<{ hash: string; amount: string; to: string }> {
  const value = parseEther(amountEth);

  // Check balance first
  const balance = await getBalance();
  if (balance.wei < value) {
    throw new Error(
      `Insufficient balance. Have ${balance.eth} ETH, need ${amountEth} ETH`
    );
  }

  // Estimate gas
  const gasEstimate = await publicClient.estimateGas({
    account: account.address,
    to: to as `0x${string}`,
    value,
  });

  // Send transaction
  const hash = await walletClient.sendTransaction({
    to: to as `0x${string}`,
    value,
    gas: gasEstimate,
  });

  return {
    hash,
    amount: amountEth,
    to,
  };
}

// Wait for transaction confirmation
export async function waitForTransaction(hash: string): Promise<{
  success: boolean;
  blockNumber: bigint;
  gasUsed: bigint;
}> {
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: hash as `0x${string}`,
  });

  return {
    success: receipt.status === "success",
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed,
  };
}

// Format address for display
export function formatAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}
