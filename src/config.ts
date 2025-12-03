import { config as dotenvConfig } from "dotenv";

dotenvConfig();

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  telegram: {
    botToken: requireEnv("TELEGRAM_BOT_TOKEN"),
    groupId: process.env.TELEGRAM_GROUP_ID || "",
  },
  ethereum: {
    rpcUrl: requireEnv("RPC_URL"),
    chainId: parseInt(process.env.CHAIN_ID || "1", 10),
  },
  safe: {
    address: requireEnv("SAFE_ADDRESS"),
    apiKey: requireEnv("SAFE_API_KEY"),
  },
  alchemy: {
    webhookSigningKey: process.env.ALCHEMY_WEBHOOK_SIGNING_KEY || "",
  },
  server: {
    port: parseInt(process.env.PORT || "3000", 10),
  },
};

// Chain ID to network name mapping
export const CHAIN_NAMES: Record<number, string> = {
  1: "mainnet",
  11155111: "sepolia",
  137: "polygon",
  42161: "arbitrum",
  10: "optimism",
  8453: "base",
};

// Safe Transaction Service URLs
export const SAFE_TX_SERVICE_URLS: Record<number, string> = {
  1: "https://safe-transaction-mainnet.safe.global",
  11155111: "https://safe-transaction-sepolia.safe.global",
  137: "https://safe-transaction-polygon.safe.global",
  42161: "https://safe-transaction-arbitrum.safe.global",
  10: "https://safe-transaction-optimism.safe.global",
  8453: "https://safe-transaction-base.safe.global",
};

// Safe Web App URL for signing
export function getSafeAppUrl(safeAddress: string, chainId: number): string {
  const chainPrefix = CHAIN_NAMES[chainId] || "eth";
  return `https://app.safe.global/home?safe=${chainPrefix}:${safeAddress}`;
}

export function getSafeTxUrl(
  safeAddress: string,
  safeTxHash: string,
  chainId: number
): string {
  const chainPrefix = CHAIN_NAMES[chainId] || "eth";
  return `https://app.safe.global/transactions/tx?safe=${chainPrefix}:${safeAddress}&id=multisig_${safeAddress}_${safeTxHash}`;
}
