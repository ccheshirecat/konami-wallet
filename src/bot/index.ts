import { Telegraf, Context } from "telegraf";
import { config, getSafeAppUrl } from "../config.js";
import {
  getSafeInfo,
  getPendingTransactions,
  getTransactionHistory,
  formatAddress,
  generateProposalInstructions,
} from "../safe/index.js";

const bot = new Telegraf(config.telegram.botToken);

// Helper to check if message is from allowed group (optional)
function isAllowedChat(ctx: Context): boolean {
  if (!config.telegram.groupId) return true;
  return ctx.chat?.id.toString() === config.telegram.groupId;
}

// /start - Welcome message and help
bot.command("start", async (ctx) => {
  const safeUrl = getSafeAppUrl(config.safe.address, config.ethereum.chainId);

  await ctx.reply(
    `Welcome to Konami Wallet Bot! \n\n` +
      `This bot helps you manage your Safe multisig wallet.\n\n` +
      `**Commands:**\n` +
      `/balance - Check wallet balance\n` +
      `/info - View Safe details (owners, threshold)\n` +
      `/pending - List pending transactions\n` +
      `/history - Recent transaction history\n` +
      `/withdraw <amount> <address> - Get instructions to withdraw\n\n` +
      `**Your Safe:** ${formatAddress(config.safe.address)}\n` +
      `**Open in Safe App:** ${safeUrl}`,
    { parse_mode: "Markdown" }
  );
});

// /help - Same as start
bot.command("help", async (ctx) => {
  await ctx.reply(
    `**Konami Wallet Commands:**\n\n` +
      `/balance - Check wallet balance\n` +
      `/info - View Safe details\n` +
      `/pending - List pending transactions\n` +
      `/history - Recent transaction history\n` +
      `/withdraw <amount> <address> - Withdrawal instructions`,
    { parse_mode: "Markdown" }
  );
});

// /balance - Check Safe balance
bot.command("balance", async (ctx) => {
  try {
    await ctx.reply("Fetching balance...");
    const info = await getSafeInfo();

    await ctx.reply(
      `**Safe Balance**\n\n` +
        `**ETH:** ${parseFloat(info.balance).toFixed(6)} ETH\n` +
        `**Address:** \`${info.address}\``,
      { parse_mode: "Markdown" }
    );
  } catch (error) {
    console.error("Balance error:", error);
    await ctx.reply("Error fetching balance. Please try again.");
  }
});

// /info - Get Safe information
bot.command("info", async (ctx) => {
  try {
    await ctx.reply("Fetching Safe info...");
    const info = await getSafeInfo();
    const safeUrl = getSafeAppUrl(config.safe.address, config.ethereum.chainId);

    const ownersFormatted = info.owners
      .map((owner, i) => `  ${i + 1}. \`${formatAddress(owner)}\``)
      .join("\n");

    await ctx.reply(
      `**Safe Information**\n\n` +
        `**Address:** \`${formatAddress(info.address)}\`\n` +
        `**Balance:** ${parseFloat(info.balance).toFixed(6)} ETH\n` +
        `**Threshold:** ${info.threshold} of ${info.owners.length} owners\n` +
        `**Nonce:** ${info.nonce}\n\n` +
        `**Owners:**\n${ownersFormatted}\n\n` +
        `[Open in Safe App](${safeUrl})`,
      { parse_mode: "Markdown" }
    );
  } catch (error) {
    console.error("Info error:", error);
    await ctx.reply("Error fetching Safe info. Please try again.");
  }
});

// /pending - List pending transactions
bot.command("pending", async (ctx) => {
  try {
    await ctx.reply("Checking pending transactions...");
    const pending = await getPendingTransactions();

    if (pending.length === 0) {
      await ctx.reply("No pending transactions.");
      return;
    }

    for (const tx of pending) {
      const confirmStatus = `${tx.confirmations}/${tx.confirmationsRequired} signatures`;
      const confirmedBy =
        tx.confirmingOwners.length > 0
          ? tx.confirmingOwners.map((o) => formatAddress(o)).join(", ")
          : "None yet";

      await ctx.reply(
        `**Pending Transaction**\n\n` +
          `**To:** \`${formatAddress(tx.to)}\`\n` +
          `**Amount:** ${tx.valueEth} ETH\n` +
          `**Status:** ${confirmStatus}\n` +
          `**Signed by:** ${confirmedBy}\n` +
          `**Submitted:** ${new Date(tx.submissionDate).toLocaleString()}\n\n` +
          `[Sign this transaction](${tx.signingUrl})`,
        { parse_mode: "Markdown" }
      );
    }
  } catch (error) {
    console.error("Pending error:", error);
    await ctx.reply("Error fetching pending transactions. Please try again.");
  }
});

// /history - Transaction history
bot.command("history", async (ctx) => {
  try {
    await ctx.reply("Fetching transaction history...");
    const history = await getTransactionHistory(5);

    if (history.length === 0) {
      await ctx.reply("No transaction history found.");
      return;
    }

    let message = `**Recent Transactions**\n\n`;

    for (const tx of history) {
      const status = tx.isSuccessful ? "Success" : "Failed";
      message +=
        `**To:** \`${formatAddress(tx.to)}\`\n` +
        `**Amount:** ${tx.valueEth} ETH\n` +
        `**Status:** ${status}\n` +
        `**Date:** ${new Date(tx.executionDate).toLocaleString()}\n` +
        `---\n`;
    }

    await ctx.reply(message, { parse_mode: "Markdown" });
  } catch (error) {
    console.error("History error:", error);
    await ctx.reply("Error fetching history. Please try again.");
  }
});

// /withdraw - Instructions to propose a withdrawal
bot.command("withdraw", async (ctx) => {
  const args = ctx.message.text.split(" ").slice(1);

  if (args.length < 2) {
    await ctx.reply(
      `**Usage:** /withdraw <amount> <address>\n\n` +
        `**Example:** /withdraw 0.5 0x1234...abcd\n\n` +
        `This will give you instructions to propose a withdrawal from the Safe.`,
      { parse_mode: "Markdown" }
    );
    return;
  }

  const amount = args[0];
  const toAddress = args[1];

  // Basic validation
  if (isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
    await ctx.reply("Invalid amount. Please enter a positive number.");
    return;
  }

  if (!toAddress.match(/^0x[a-fA-F0-9]{40}$/)) {
    await ctx.reply("Invalid Ethereum address format.");
    return;
  }

  const instructions = generateProposalInstructions(toAddress, amount);

  await ctx.reply(
    `**Withdrawal Request**\n\n` +
      `**Amount:** ${amount} ETH\n` +
      `**To:** \`${toAddress}\`\n\n` +
      instructions,
    { parse_mode: "Markdown" }
  );
});

// Error handling
bot.catch((err, ctx) => {
  console.error("Bot error:", err);
  ctx.reply("An error occurred. Please try again.");
});

export { bot };

export async function startBot(): Promise<void> {
  await bot.launch();
  console.log("Bot started successfully!");

  // Enable graceful stop
  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
}
