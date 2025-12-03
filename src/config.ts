import { config as dotenvConfig } from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

// Get the directory of this file, then go up to project root
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = resolve(__dirname, "..", ".env");

dotenvConfig({ path: envPath });

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

// Parse authorized users from comma-separated string
function parseAuthorizedUsers(envVar: string): number[] {
  const value = process.env[envVar] || "";
  return value
    .split(",")
    .map((id) => parseInt(id.trim(), 10))
    .filter((id) => !isNaN(id));
}

export const config = {
  telegram: {
    botToken: requireEnv("TELEGRAM_BOT_TOKEN"),
    groupId: process.env.TELEGRAM_GROUP_ID || "",
    authorizedUsers: parseAuthorizedUsers("AUTHORIZED_USERS"), // Telegram user IDs
    requiredApprovals: parseInt(process.env.REQUIRED_APPROVALS || "2", 10),
  },
  wallet: {
    privateKey: requireEnv("WALLET_PRIVATE_KEY"),
  },
  ethereum: {
    rpcUrl: requireEnv("RPC_URL"),
    chainId: parseInt(process.env.CHAIN_ID || "1", 10),
  },
  alchemy: {
    webhookSigningKey: process.env.ALCHEMY_WEBHOOK_SIGNING_KEY || "",
  },
  openrouter: {
    apiKey: process.env.OPENROUTER_API_KEY || "",
    model: process.env.OPENROUTER_MODEL || "cognitivecomputations/dolphin-mistral-24b-venice-edition:free",
  },
  server: {
    port: parseInt(process.env.PORT || "3000", 10),
    domain: process.env.DOMAIN || "",
  },
};

// Validate config
if (config.telegram.authorizedUsers.length < config.telegram.requiredApprovals) {
  console.warn(
    `Warning: Only ${config.telegram.authorizedUsers.length} authorized users but ${config.telegram.requiredApprovals} approvals required`
  );
}

// Chain explorers
export function getExplorerUrl(txHash: string): string {
  const chainId = config.ethereum.chainId;
  switch (chainId) {
    case 1:
      return `https://etherscan.io/tx/${txHash}`;
    case 137:
      return `https://polygonscan.com/tx/${txHash}`;
    case 42161:
      return `https://arbiscan.io/tx/${txHash}`;
    case 10:
      return `https://optimistic.etherscan.io/tx/${txHash}`;
    case 8453:
      return `https://basescan.org/tx/${txHash}`;
    case 11155111:
      return `https://sepolia.etherscan.io/tx/${txHash}`;
    default:
      return `https://etherscan.io/tx/${txHash}`;
  }
}

export function getAddressExplorerUrl(address: string): string {
  const chainId = config.ethereum.chainId;
  switch (chainId) {
    case 1:
      return `https://etherscan.io/address/${address}`;
    case 137:
      return `https://polygonscan.com/address/${address}`;
    case 42161:
      return `https://arbiscan.io/address/${address}`;
    case 10:
      return `https://optimistic.etherscan.io/address/${address}`;
    case 8453:
      return `https://basescan.org/address/${address}`;
    case 11155111:
      return `https://sepolia.etherscan.io/address/${address}`;
    default:
      return `https://etherscan.io/address/${address}`;
  }
}
