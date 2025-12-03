import { startBot } from "./bot/index.js";
import { startServer } from "./server/index.js";
import { startPendingTxPolling } from "./listener/index.js";
import { getSafeInfo } from "./safe/index.js";
import { config, getSafeAppUrl } from "./config.js";

async function main() {
  console.log("=========================================");
  console.log("    Konami Wallet Bot - Starting Up");
  console.log("=========================================\n");

  // Validate Safe connection
  try {
    console.log("[1/4] Connecting to Safe...");
    const safeInfo = await getSafeInfo();
    console.log(`      Address: ${safeInfo.address}`);
    console.log(`      Balance: ${parseFloat(safeInfo.balance).toFixed(6)} ETH`);
    console.log(`      Owners: ${safeInfo.owners.length}`);
    console.log(`      Threshold: ${safeInfo.threshold} of ${safeInfo.owners.length}`);
    console.log(`      Safe App: ${getSafeAppUrl(safeInfo.address, config.ethereum.chainId)}`);
    console.log("      Safe connection successful!\n");
  } catch (error) {
    console.error("Failed to connect to Safe:", error);
    console.error("\nPlease check your SAFE_ADDRESS and RPC_URL in .env");
    process.exit(1);
  }

  // Start the webhook server
  try {
    console.log("[2/4] Starting webhook server...");
    startServer();
    console.log("      Webhook server is running!\n");
  } catch (error) {
    console.error("Failed to start webhook server:", error);
    process.exit(1);
  }

  // Start the Telegram bot
  try {
    console.log("[3/4] Starting Telegram bot...");
    await startBot();
    console.log("      Telegram bot is running!\n");
  } catch (error) {
    console.error("Failed to start Telegram bot:", error);
    console.error("\nPlease check your TELEGRAM_BOT_TOKEN in .env");
    process.exit(1);
  }

  // Start pending transaction polling
  if (config.telegram.groupId) {
    console.log("[4/4] Starting pending transaction monitor...");
    await startPendingTxPolling(30000); // Check every 30 seconds
    console.log("      Pending transaction monitor is running!\n");
  } else {
    console.log(
      "[4/4] Skipping pending transaction monitor (TELEGRAM_GROUP_ID not set)\n"
    );
  }

  console.log("=========================================");
  console.log("    Bot is ready! Send /start to begin");
  console.log("=========================================\n");

  console.log("Available commands:");
  console.log("  /balance  - Check wallet balance");
  console.log("  /info     - View Safe details");
  console.log("  /pending  - List pending transactions");
  console.log("  /history  - Recent transaction history");
  console.log("  /withdraw - Get withdrawal instructions\n");

  if (!config.alchemy.webhookSigningKey) {
    console.log("Note: ALCHEMY_WEBHOOK_SIGNING_KEY not set.");
    console.log("      Incoming transaction notifications require Alchemy webhook setup.");
    console.log("      See setup instructions in .env.example\n");
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
