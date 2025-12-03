import { config } from "../config.js";
import { getWalletAddress, getBalance, formatAddress } from "../wallet/index.js";
import { getPendingWithdrawals, getApprovalStatus } from "../store/pending.js";

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";

// Build system prompt with wallet context
async function buildSystemPrompt(): Promise<string> {
  let walletInfo = "";

  try {
    const address = getWalletAddress();
    const balance = await getBalance();
    const pending = getPendingWithdrawals();

    walletInfo = `
Current Wallet Status:
- Address: ${address}
- Balance: ${balance.eth} ETH
- Chain: ${config.ethereum.chainId === 1 ? "Ethereum Mainnet" : `Chain ID ${config.ethereum.chainId}`}
- Pending Withdrawals: ${pending.length}
${pending.map(p => `  - ${p.amount} ETH to ${formatAddress(p.to)} (${getApprovalStatus(p)} approvals)`).join("\n")}
`;
  } catch (e) {
    walletInfo = "(Unable to fetch wallet status)";
  }

  return `You are Konami, a friendly and helpful assistant integrated into a Telegram group wallet bot. You help manage a shared cryptocurrency wallet for a small business.

SYSTEM CONTEXT:
This is a Telegram bot that manages an Ethereum wallet. The wallet receives business revenue and requires ${config.telegram.requiredApprovals} approvals from authorized team members before any withdrawal can be executed. This ensures no single person can withdraw funds unilaterally.

BOT COMMANDS (for reference, users run these directly):
- /balance - Check wallet balance
- /withdraw <amount> <address> - Request a withdrawal (needs approval)
- /approve - Approve a pending withdrawal
- /reject - Reject a pending withdrawal
- /pending - Show pending withdrawals
- /whoami - Get Telegram user ID

${walletInfo}

PERSONALITY:
- Be friendly, casual, and helpful
- You can discuss anything - crypto, tech, random topics, whatever
- Help troubleshoot wallet issues if asked
- You're part of the team, not just a tool
- Feel free to use humor and be personable
- If someone asks about making a withdrawal, remind them of the commands but you cannot execute transactions yourself - they need to use the /withdraw command

Remember: You're chatting with the business partners who own this wallet. Be helpful and natural!`;
}

interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

// Simple conversation memory per chat (last few messages)
const conversationHistory = new Map<number, Message[]>();
const MAX_HISTORY = 10;

export async function chat(
  chatId: number,
  userMessage: string,
  userName: string
): Promise<string> {
  if (!config.openrouter.apiKey) {
    return "Chat is disabled - no OPENROUTER_API_KEY configured.";
  }

  try {
    // Get or create conversation history
    let history = conversationHistory.get(chatId) || [];

    // Build system prompt with current wallet state
    const systemPrompt = await buildSystemPrompt();

    // Add user message to history
    history.push({
      role: "user",
      content: `[${userName}]: ${userMessage}`,
    });

    // Trim history if too long
    if (history.length > MAX_HISTORY) {
      history = history.slice(-MAX_HISTORY);
    }

    // Build messages array
    const messages: Message[] = [
      { role: "system", content: systemPrompt },
      ...history,
    ];

    // Call OpenRouter API
    const response = await fetch(OPENROUTER_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${config.openrouter.apiKey}`,
        "HTTP-Referer": "https://github.com/konami-wallet",
        "X-Title": "Konami Wallet Bot",
      },
      body: JSON.stringify({
        model: config.openrouter.model,
        messages,
        max_tokens: 500,
        temperature: 0.8,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error("OpenRouter error:", error);
      return "Sorry, I'm having trouble thinking right now. Try again?";
    }

    const data = await response.json();
    const assistantMessage = data.choices?.[0]?.message?.content || "...";

    // Add assistant response to history
    history.push({
      role: "assistant",
      content: assistantMessage,
    });

    // Save updated history
    conversationHistory.set(chatId, history);

    return assistantMessage;
  } catch (error) {
    console.error("Chat error:", error);
    return "Oops, something went wrong. Try again?";
  }
}

// Clear conversation history for a chat
export function clearHistory(chatId: number): void {
  conversationHistory.delete(chatId);
}
