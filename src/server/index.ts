import express, { Request, Response } from "express";
import crypto from "crypto";
import { config } from "../config.js";
import { bot } from "../bot/index.js";
import { formatAddress } from "../safe/index.js";
import { formatEther } from "viem";

const app = express();

// Alchemy webhook signing key validation
function isValidAlchemySignature(
  body: string,
  signature: string,
  signingKey: string
): boolean {
  const hmac = crypto.createHmac("sha256", signingKey);
  hmac.update(body, "utf8");
  const digest = hmac.digest("hex");
  return signature === digest;
}

// Raw body parser for signature verification
app.use(
  express.json({
    verify: (req: Request, _res, buf) => {
      (req as Request & { rawBody: string }).rawBody = buf.toString();
    },
  })
);

// Health check endpoint
app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Alchemy Address Activity Webhook
// Docs: https://docs.alchemy.com/reference/address-activity-webhook
app.post("/webhook/alchemy", async (req: Request, res: Response) => {
  try {
    const signature = req.headers["x-alchemy-signature"] as string;
    const rawBody = (req as Request & { rawBody: string }).rawBody;

    // Validate signature if signing key is configured
    if (config.alchemy.webhookSigningKey) {
      if (!signature || !isValidAlchemySignature(rawBody, signature, config.alchemy.webhookSigningKey)) {
        console.error("Invalid Alchemy webhook signature");
        res.status(401).json({ error: "Invalid signature" });
        return;
      }
    }

    const payload = req.body;

    // Alchemy Address Activity webhook payload structure
    // https://docs.alchemy.com/reference/address-activity-webhook
    if (payload.type !== "ADDRESS_ACTIVITY") {
      res.json({ received: true, processed: false, reason: "Not address activity" });
      return;
    }

    const safeAddress = config.safe.address.toLowerCase();
    const groupId = config.telegram.groupId;

    if (!groupId) {
      console.log("No group ID configured, skipping notification");
      res.json({ received: true, processed: false, reason: "No group ID" });
      return;
    }

    // Process each activity in the webhook
    for (const activity of payload.event?.activity || []) {
      // Only process incoming ETH transfers to our Safe
      if (
        activity.toAddress?.toLowerCase() === safeAddress &&
        activity.category === "external" &&
        activity.asset === "ETH"
      ) {
        const valueWei = BigInt(Math.floor(activity.value * 1e18));
        const valueEth = formatEther(valueWei);

        const explorerUrl = getExplorerUrl(activity.hash);

        const message =
          `**Incoming Transaction**\n\n` +
          `**Amount:** ${valueEth} ETH\n` +
          `**From:** \`${formatAddress(activity.fromAddress)}\`\n` +
          `**Tx:** \`${formatAddress(activity.hash)}\`\n\n` +
          `[View on Explorer](${explorerUrl})`;

        try {
          await bot.telegram.sendMessage(groupId, message, {
            parse_mode: "Markdown",
          });
          console.log(`Notified incoming transfer: ${activity.hash}`);
        } catch (err) {
          console.error("Failed to send Telegram notification:", err);
        }
      }

      // Also notify on outgoing transactions (executed Safe transactions)
      if (
        activity.fromAddress?.toLowerCase() === safeAddress &&
        activity.category === "external" &&
        activity.asset === "ETH"
      ) {
        const valueWei = BigInt(Math.floor(activity.value * 1e18));
        const valueEth = formatEther(valueWei);

        const explorerUrl = getExplorerUrl(activity.hash);

        const message =
          `**Outgoing Transaction Executed**\n\n` +
          `**Amount:** ${valueEth} ETH\n` +
          `**To:** \`${formatAddress(activity.toAddress)}\`\n` +
          `**Tx:** \`${formatAddress(activity.hash)}\`\n\n` +
          `[View on Explorer](${explorerUrl})`;

        try {
          await bot.telegram.sendMessage(groupId, message, {
            parse_mode: "Markdown",
          });
          console.log(`Notified outgoing transfer: ${activity.hash}`);
        } catch (err) {
          console.error("Failed to send Telegram notification:", err);
        }
      }
    }

    res.json({ received: true, processed: true });
  } catch (error) {
    console.error("Webhook error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

function getExplorerUrl(txHash: string): string {
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

export function startServer(): void {
  const port = config.server.port;
  app.listen(port, () => {
    console.log(`Webhook server listening on port ${port}`);
    console.log(`Alchemy webhook URL: http://your-server:${port}/webhook/alchemy`);
  });
}

export { app };
