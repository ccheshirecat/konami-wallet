import { config } from "../config.js";
import { bot } from "../bot/index.js";
import { getPendingTransactions, formatAddress, PendingTransaction } from "../safe/index.js";

// Store known pending transactions to detect changes
let knownPendingTxs: Map<string, PendingTransaction> = new Map();
let isPolling = false;

async function checkPendingTransactions(): Promise<void> {
  try {
    const currentPending = await getPendingTransactions();
    const groupId = config.telegram.groupId;

    if (!groupId) {
      return;
    }

    for (const tx of currentPending) {
      const known = knownPendingTxs.get(tx.safeTxHash);

      if (!known) {
        // New pending transaction
        const message =
          `**New Transaction Proposed**\n\n` +
          `**To:** \`${formatAddress(tx.to)}\`\n` +
          `**Amount:** ${tx.valueEth} ETH\n` +
          `**Signatures:** ${tx.confirmations}/${tx.confirmationsRequired}\n` +
          `**Proposed:** ${new Date(tx.submissionDate).toLocaleString()}\n\n` +
          `[Sign this transaction](${tx.signingUrl})`;

        await bot.telegram.sendMessage(groupId, message, {
          parse_mode: "Markdown",
        });
        console.log(`Notified new pending tx: ${tx.safeTxHash}`);
      } else if (tx.confirmations > known.confirmations) {
        // New signature added
        const newSigners = tx.confirmingOwners.filter(
          (owner) => !known.confirmingOwners.includes(owner)
        );

        const signerList = newSigners.map((s) => formatAddress(s)).join(", ");

        if (tx.confirmations >= tx.confirmationsRequired) {
          // Ready to execute
          const message =
            `**Transaction Ready to Execute**\n\n` +
            `**To:** \`${formatAddress(tx.to)}\`\n` +
            `**Amount:** ${tx.valueEth} ETH\n` +
            `**Signed by:** ${signerList}\n` +
            `**Status:** All signatures collected (${tx.confirmations}/${tx.confirmationsRequired})\n\n` +
            `[Execute transaction](${tx.signingUrl})`;

          await bot.telegram.sendMessage(groupId, message, {
            parse_mode: "Markdown",
          });
          console.log(`Notified tx ready to execute: ${tx.safeTxHash}`);
        } else {
          // Needs more signatures
          const message =
            `**New Signature Added**\n\n` +
            `**To:** \`${formatAddress(tx.to)}\`\n` +
            `**Amount:** ${tx.valueEth} ETH\n` +
            `**Signed by:** ${signerList}\n` +
            `**Status:** ${tx.confirmations}/${tx.confirmationsRequired} signatures\n\n` +
            `[Add your signature](${tx.signingUrl})`;

          await bot.telegram.sendMessage(groupId, message, {
            parse_mode: "Markdown",
          });
          console.log(`Notified new signature: ${tx.safeTxHash}`);
        }
      }
    }

    // Check for executed/cancelled transactions (no longer pending)
    for (const [safeTxHash, known] of knownPendingTxs) {
      const stillPending = currentPending.find(
        (tx) => tx.safeTxHash === safeTxHash
      );
      if (!stillPending && known.confirmations >= known.confirmationsRequired) {
        // Transaction was executed (removed from pending)
        // Note: Alchemy webhook will handle the actual execution notification
        console.log(`Transaction no longer pending (likely executed): ${safeTxHash}`);
      }
    }

    // Update known transactions
    knownPendingTxs = new Map(
      currentPending.map((tx) => [tx.safeTxHash, tx])
    );
  } catch (error) {
    console.error("Error checking pending transactions:", error);
  }
}

export async function startPendingTxPolling(intervalMs = 30000): Promise<void> {
  if (isPolling) {
    console.log("Pending tx polling already started");
    return;
  }

  isPolling = true;
  console.log(
    `Starting pending transaction polling (every ${intervalMs / 1000}s)...`
  );

  // Initial load of pending transactions (don't notify on startup)
  try {
    const initialPending = await getPendingTransactions();
    knownPendingTxs = new Map(
      initialPending.map((tx) => [tx.safeTxHash, tx])
    );
    console.log(`Loaded ${initialPending.length} pending transaction(s)`);
  } catch (error) {
    console.error("Error loading initial pending transactions:", error);
  }

  const poll = async () => {
    if (!isPolling) return;

    await checkPendingTransactions();

    // Schedule next poll
    setTimeout(poll, intervalMs);
  };

  // Start polling after initial interval
  setTimeout(poll, intervalMs);
}

export function stopPolling(): void {
  isPolling = false;
  console.log("Polling stopped");
}
