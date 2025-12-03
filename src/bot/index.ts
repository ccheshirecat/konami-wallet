import { Telegraf } from "telegraf";
import { config, getExplorerUrl } from "../config.js";
import {
  getBalance,
  getWalletAddress,
  sendTransaction,
  waitForTransaction,
  formatAddress,
} from "../wallet/index.js";
import {
  createWithdrawal,
  getPendingWithdrawals,
  getLatestPendingWithdrawal,
  addApproval,
  rejectWithdrawal,
  markExecuted,
  getApprovalStatus,
  isUserAuthorized,
  getWithdrawal,
} from "../store/pending.js";

const bot = new Telegraf(config.telegram.botToken);

// Middleware to check authorization
function requireAuth(ctx: any, next: () => Promise<void>): Promise<void> | void {
  const userId = ctx.from?.id;
  if (!userId || !isUserAuthorized(userId)) {
    return ctx.reply("You are not authorized to use this bot.");
  }
  return next();
}

// /start - Welcome message
bot.command("start", async (ctx) => {
  const walletAddress = getWalletAddress();
  const userId = ctx.from?.id;
  const isAuthorized = userId ? isUserAuthorized(userId) : false;

  await ctx.reply(
    `*Konami Wallet Bot*\n\n` +
      `Wallet: \`${walletAddress}\`\n` +
      `Your ID: \`${userId}\`\n` +
      `Authorized: ${isAuthorized ? "Yes" : "No"}\n\n` +
      `*Commands:*\n` +
      `/balance - Check wallet balance\n` +
      `/withdraw <amount> <address> - Request withdrawal\n` +
      `/approve - Approve pending withdrawal\n` +
      `/reject - Reject pending withdrawal\n` +
      `/pending - Show pending withdrawals\n` +
      `/whoami - Show your Telegram user ID`,
    { parse_mode: "Markdown" }
  );
});

// /whoami - Show user's Telegram ID (useful for setup)
bot.command("whoami", async (ctx) => {
  const userId = ctx.from?.id;
  const username = ctx.from?.username || "no username";
  const firstName = ctx.from?.first_name || "";

  await ctx.reply(
    `*Your Telegram Info*\n\n` +
      `User ID: \`${userId}\`\n` +
      `Username: @${username}\n` +
      `Name: ${firstName}\n\n` +
      `_Add your User ID to AUTHORIZED\\_USERS in .env to authorize yourself._`,
    { parse_mode: "Markdown" }
  );
});

// /balance - Check wallet balance
bot.command("balance", requireAuth, async (ctx) => {
  try {
    const balance = await getBalance();
    const address = getWalletAddress();

    await ctx.reply(
      `*Wallet Balance*\n\n` +
        `*ETH:* ${parseFloat(balance.eth).toFixed(6)} ETH\n` +
        `*Address:* \`${address}\``,
      { parse_mode: "Markdown" }
    );
  } catch (error) {
    console.error("Balance error:", error);
    await ctx.reply("Error fetching balance. Please try again.");
  }
});

// /withdraw <amount> <address> - Request withdrawal
bot.command("withdraw", requireAuth, async (ctx) => {
  const userId = ctx.from?.id;
  const userName = ctx.from?.first_name || ctx.from?.username || "Unknown";

  if (!userId) {
    return ctx.reply("Could not identify user.");
  }

  const args = ctx.message.text.split(" ").slice(1);

  if (args.length < 2) {
    return ctx.reply(
      `*Usage:* /withdraw <amount> <address>\n\n` +
        `*Example:* /withdraw 0.5 0x1234...abcd`,
      { parse_mode: "Markdown" }
    );
  }

  const amount = args[0];
  const toAddress = args[1];

  // Validate amount
  const amountNum = parseFloat(amount);
  if (isNaN(amountNum) || amountNum <= 0) {
    return ctx.reply("Invalid amount. Please enter a positive number.");
  }

  // Validate address
  if (!toAddress.match(/^0x[a-fA-F0-9]{40}$/)) {
    return ctx.reply("Invalid Ethereum address format.");
  }

  // Check if there's already a pending withdrawal
  const existingPending = getLatestPendingWithdrawal();
  if (existingPending) {
    return ctx.reply(
      `There's already a pending withdrawal:\n\n` +
        `*Amount:* ${existingPending.amount} ETH\n` +
        `*To:* \`${formatAddress(existingPending.to)}\`\n` +
        `*Status:* ${getApprovalStatus(existingPending)} approvals\n\n` +
        `Use /approve or /reject first.`,
      { parse_mode: "Markdown" }
    );
  }

  // Check balance
  try {
    const balance = await getBalance();
    if (parseFloat(balance.eth) < amountNum) {
      return ctx.reply(
        `Insufficient balance.\n` +
          `*Have:* ${parseFloat(balance.eth).toFixed(6)} ETH\n` +
          `*Need:* ${amount} ETH`,
        { parse_mode: "Markdown" }
      );
    }
  } catch (error) {
    console.error("Balance check error:", error);
    return ctx.reply("Error checking balance. Please try again.");
  }

  // Create withdrawal request
  const withdrawal = createWithdrawal(userId, userName, toAddress, amount);

  const requiredApprovals = config.telegram.requiredApprovals;
  const currentApprovals = withdrawal.approvals.size;

  await ctx.reply(
    `*New Withdrawal Request*\n\n` +
      `*ID:* \`${withdrawal.id}\`\n` +
      `*Amount:* ${amount} ETH\n` +
      `*To:* \`${toAddress}\`\n` +
      `*Requested by:* ${userName}\n` +
      `*Approvals:* ${currentApprovals}/${requiredApprovals}\n\n` +
      `${
        currentApprovals >= requiredApprovals
          ? "✅ *Fully approved! Executing...*"
          : `⏳ *Waiting for ${requiredApprovals - currentApprovals} more approval(s)*\n\nOther authorized users: reply /approve to approve or /reject to cancel.`
      }`,
    { parse_mode: "Markdown" }
  );

  // Auto-execute if single approval is enough (e.g., 1-of-1)
  if (currentApprovals >= requiredApprovals) {
    await executeWithdrawal(ctx, withdrawal.id);
  }
});

// /approve - Approve pending withdrawal
bot.command("approve", requireAuth, async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId) {
    return ctx.reply("Could not identify user.");
  }

  const pending = getLatestPendingWithdrawal();
  if (!pending) {
    return ctx.reply("No pending withdrawal to approve.");
  }

  if (pending.approvals.has(userId)) {
    return ctx.reply("You have already approved this withdrawal.");
  }

  const result = addApproval(pending.id, userId);
  if (!result) {
    return ctx.reply("Could not approve withdrawal.");
  }

  const { withdrawal, isFullyApproved } = result;
  const userName = ctx.from?.first_name || ctx.from?.username || "Unknown";

  await ctx.reply(
    `✅ *Approved by ${userName}*\n\n` +
      `*Amount:* ${withdrawal.amount} ETH\n` +
      `*To:* \`${formatAddress(withdrawal.to)}\`\n` +
      `*Approvals:* ${getApprovalStatus(withdrawal)}\n\n` +
      `${isFullyApproved ? "🚀 *Fully approved! Executing transaction...*" : "⏳ *Waiting for more approvals...*"}`,
    { parse_mode: "Markdown" }
  );

  if (isFullyApproved) {
    await executeWithdrawal(ctx, withdrawal.id);
  }
});

// /reject - Reject pending withdrawal
bot.command("reject", requireAuth, async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId) {
    return ctx.reply("Could not identify user.");
  }

  const pending = getLatestPendingWithdrawal();
  if (!pending) {
    return ctx.reply("No pending withdrawal to reject.");
  }

  const withdrawal = rejectWithdrawal(pending.id, userId);
  if (!withdrawal) {
    return ctx.reply("Could not reject withdrawal.");
  }

  const userName = ctx.from?.first_name || ctx.from?.username || "Unknown";

  await ctx.reply(
    `❌ *Withdrawal Rejected by ${userName}*\n\n` +
      `*Amount:* ${withdrawal.amount} ETH\n` +
      `*To:* \`${formatAddress(withdrawal.to)}\`\n\n` +
      `The withdrawal request has been cancelled.`,
    { parse_mode: "Markdown" }
  );
});

// /pending - Show pending withdrawals
bot.command("pending", requireAuth, async (ctx) => {
  const pending = getPendingWithdrawals();

  if (pending.length === 0) {
    return ctx.reply("No pending withdrawals.");
  }

  for (const withdrawal of pending) {
    await ctx.reply(
      `*Pending Withdrawal*\n\n` +
        `*ID:* \`${withdrawal.id}\`\n` +
        `*Amount:* ${withdrawal.amount} ETH\n` +
        `*To:* \`${withdrawal.to}\`\n` +
        `*Requested by:* ${withdrawal.requestedByName}\n` +
        `*Approvals:* ${getApprovalStatus(withdrawal)}\n` +
        `*Created:* ${withdrawal.createdAt.toLocaleString()}\n\n` +
        `Use /approve or /reject`,
      { parse_mode: "Markdown" }
    );
  }
});

// Execute a fully approved withdrawal
async function executeWithdrawal(ctx: any, withdrawalId: string): Promise<void> {
  const withdrawal = getWithdrawal(withdrawalId);
  if (!withdrawal) {
    await ctx.reply("Withdrawal not found.");
    return;
  }

  try {
    await ctx.reply("📤 *Sending transaction...*", { parse_mode: "Markdown" });

    const result = await sendTransaction(withdrawal.to, withdrawal.amount);

    await ctx.reply(
      `✅ *Transaction Sent!*\n\n` +
        `*Amount:* ${result.amount} ETH\n` +
        `*To:* \`${formatAddress(result.to)}\`\n` +
        `*TX Hash:* \`${formatAddress(result.hash)}\`\n\n` +
        `[View on Explorer](${getExplorerUrl(result.hash)})\n\n` +
        `⏳ *Waiting for confirmation...*`,
      { parse_mode: "Markdown" }
    );

    // Wait for confirmation
    const receipt = await waitForTransaction(result.hash);

    markExecuted(withdrawalId);

    if (receipt.success) {
      await ctx.reply(
        `🎉 *Transaction Confirmed!*\n\n` +
          `*Block:* ${receipt.blockNumber}\n` +
          `*Gas Used:* ${receipt.gasUsed}\n\n` +
          `[View on Explorer](${getExplorerUrl(result.hash)})`,
        { parse_mode: "Markdown" }
      );
    } else {
      await ctx.reply(
        `⚠️ *Transaction Failed*\n\n` +
          `The transaction was mined but failed. Check the explorer for details.\n\n` +
          `[View on Explorer](${getExplorerUrl(result.hash)})`,
        { parse_mode: "Markdown" }
      );
    }
  } catch (error) {
    console.error("Transaction error:", error);
    await ctx.reply(
      `❌ *Transaction Failed*\n\n` +
        `Error: ${error instanceof Error ? error.message : "Unknown error"}\n\n` +
        `The withdrawal has been cancelled. Please try again.`,
      { parse_mode: "Markdown" }
    );
    rejectWithdrawal(withdrawalId, 0);
  }
}

// Error handling
bot.catch((err, ctx) => {
  console.error("Bot error:", err);
  ctx.reply("An error occurred. Please try again.");
});

export { bot };

export async function startBot(): Promise<void> {
  try {
    console.log("Starting Telegram bot...");

    const botInfo = await bot.telegram.getMe();
    console.log("Bot info:", botInfo.username, botInfo.id);

    // Use webhooks if domain is configured
    if (config.server.domain) {
      const webhookUrl = `https://${config.server.domain}/webhook/telegram/${config.telegram.botToken}`;
      console.log("Setting up webhook...");

      await bot.telegram.setWebhook(webhookUrl, {
        drop_pending_updates: true,
        allowed_updates: ["message", "callback_query"],
      });

      console.log("Bot webhook configured!");
    } else {
      // Polling fallback
      console.log("Using polling mode...");
      await bot.launch({
        dropPendingUpdates: true,
        allowedUpdates: ["message", "callback_query"],
      });

      console.log("Bot polling started!");

      process.once("SIGINT", () => bot.stop("SIGINT"));
      process.once("SIGTERM", () => bot.stop("SIGTERM"));
    }
  } catch (error) {
    console.error("Failed to start bot:", error);
    throw error;
  }
}
