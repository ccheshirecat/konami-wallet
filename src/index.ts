import { startBot } from "./bot/index.js";
import { startServer } from "./server/index.js";
import { getBalance, getWalletAddress } from "./wallet/index.js";
import { config } from "./config.js";

async function main() {
  console.log("=========================================");
  console.log("    Konami Wallet Bot - Starting Up");
  console.log("=========================================\n");

  // Show wallet info
  try {
    console.log("[1/3] Connecting to wallet...");
    const address = getWalletAddress();
    const balance = await getBalance();
    console.log(`      Address: ${address}`);
    console.log(`      Balance: ${parseFloat(balance.eth).toFixed(6)} ETH`);
    console.log(`      Chain ID: ${config.ethereum.chainId}`);
    console.log("      Wallet connected!\n");
  } catch (error) {
    console.error("Failed to connect to wallet:", error);
    process.exit(1);
  }

  // Show authorization config
  console.log(`      Authorized users: ${config.telegram.authorizedUsers.length}`);
  console.log(`      Required approvals: ${config.telegram.requiredApprovals}\n`);

  // Start webhook server
  try {
    console.log("[2/3] Starting webhook server...");
    startServer();
    console.log("      Server is running!\n");
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }

  // Start Telegram bot
  try {
    console.log("[3/3] Starting Telegram bot...");
    await startBot();
    console.log("      Bot is running!\n");
  } catch (error) {
    console.error("Failed to start bot:", error);
    process.exit(1);
  }

  console.log("=========================================");
  console.log("    Bot is ready!");
  console.log("=========================================\n");

  console.log("Commands:");
  console.log("  /start    - Show bot info");
  console.log("  /whoami   - Get your Telegram user ID");
  console.log("  /balance  - Check wallet balance");
  console.log("  /withdraw - Request withdrawal (needs approval)");
  console.log("  /approve  - Approve pending withdrawal");
  console.log("  /reject   - Reject pending withdrawal");
  console.log("  /pending  - Show pending withdrawals\n");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
