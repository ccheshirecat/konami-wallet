import express, { Request, Response } from "express";
import crypto from "crypto";
import { config, getExplorerUrl } from "../config.js";
import { bot } from "../bot/index.js";
import { formatAddress } from "../wallet/index.js";
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

// Telegram webhook endpoint
app.post(`/webhook/telegram/:token`, (req, res) => {
  if (req.params.token !== config.telegram.botToken) {
    res.status(401).json({ error: "Invalid token" });
    return;
  }
  bot.handleUpdate(req.body, res);
});

// Alchemy Address Activity Webhook for incoming TX notifications
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

    if (payload.type !== "ADDRESS_ACTIVITY") {
      res.json({ received: true, processed: false, reason: "Not address activity" });
      return;
    }

    const groupId = config.telegram.groupId;
    if (!groupId) {
      console.log("No group ID configured, skipping notification");
      res.json({ received: true, processed: false, reason: "No group ID" });
      return;
    }

    // Process each activity
    for (const activity of payload.event?.activity || []) {
      // Incoming ETH transfer
      if (activity.category === "external" && activity.asset === "ETH" && activity.value > 0) {
        const valueWei = BigInt(Math.floor(activity.value * 1e18));
        const valueEth = formatEther(valueWei);

        const message =
          `💰 *Incoming Transaction*\n\n` +
          `*Amount:* ${valueEth} ETH\n` +
          `*From:* \`${formatAddress(activity.fromAddress)}\`\n` +
          `*TX:* \`${formatAddress(activity.hash)}\`\n\n` +
          `[View on Explorer](${getExplorerUrl(activity.hash)})`;

        try {
          await bot.telegram.sendMessage(groupId, message, {
            parse_mode: "Markdown",
          });
          console.log(`Notified incoming: ${activity.hash}`);
        } catch (err) {
          console.error("Failed to send notification:", err);
        }
      }
    }

    res.json({ received: true, processed: true });
  } catch (error) {
    console.error("Webhook error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export function startServer(): void {
  const port = config.server.port;
  app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
  });
}

export { app };
