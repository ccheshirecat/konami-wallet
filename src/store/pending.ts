import { config } from "../config.js";

export interface PendingWithdrawal {
  id: string;
  requestedBy: number; // Telegram user ID
  requestedByName: string;
  to: string;
  amount: string; // ETH amount as string
  approvals: Set<number>; // Telegram user IDs who approved
  createdAt: Date;
  status: "pending" | "approved" | "rejected" | "executed";
}

// In-memory store for pending withdrawals
// In production, you might want to persist this to disk/database
const pendingWithdrawals = new Map<string, PendingWithdrawal>();

let idCounter = 0;

function generateId(): string {
  idCounter++;
  return `WD-${Date.now()}-${idCounter}`;
}

export function createWithdrawal(
  requestedBy: number,
  requestedByName: string,
  to: string,
  amount: string
): PendingWithdrawal {
  const id = generateId();
  const withdrawal: PendingWithdrawal = {
    id,
    requestedBy,
    requestedByName,
    to,
    amount,
    approvals: new Set([requestedBy]), // Requester auto-approves
    createdAt: new Date(),
    status: "pending",
  };

  pendingWithdrawals.set(id, withdrawal);
  return withdrawal;
}

export function getWithdrawal(id: string): PendingWithdrawal | undefined {
  return pendingWithdrawals.get(id);
}

export function getPendingWithdrawals(): PendingWithdrawal[] {
  return Array.from(pendingWithdrawals.values()).filter(
    (w) => w.status === "pending"
  );
}

export function getLatestPendingWithdrawal(): PendingWithdrawal | undefined {
  const pending = getPendingWithdrawals();
  return pending[pending.length - 1];
}

export function addApproval(
  id: string,
  userId: number
): { withdrawal: PendingWithdrawal; isFullyApproved: boolean } | null {
  const withdrawal = pendingWithdrawals.get(id);
  if (!withdrawal || withdrawal.status !== "pending") {
    return null;
  }

  withdrawal.approvals.add(userId);

  const isFullyApproved =
    withdrawal.approvals.size >= config.telegram.requiredApprovals;

  if (isFullyApproved) {
    withdrawal.status = "approved";
  }

  return { withdrawal, isFullyApproved };
}

export function rejectWithdrawal(id: string, userId: number): PendingWithdrawal | null {
  const withdrawal = pendingWithdrawals.get(id);
  if (!withdrawal || withdrawal.status !== "pending") {
    return null;
  }

  withdrawal.status = "rejected";
  return withdrawal;
}

export function markExecuted(id: string): void {
  const withdrawal = pendingWithdrawals.get(id);
  if (withdrawal) {
    withdrawal.status = "executed";
  }
}

export function clearOldWithdrawals(maxAgeMs: number = 24 * 60 * 60 * 1000): void {
  const now = Date.now();
  for (const [id, withdrawal] of pendingWithdrawals) {
    if (now - withdrawal.createdAt.getTime() > maxAgeMs) {
      pendingWithdrawals.delete(id);
    }
  }
}

export function getApprovalStatus(withdrawal: PendingWithdrawal): string {
  return `${withdrawal.approvals.size}/${config.telegram.requiredApprovals}`;
}

export function isUserAuthorized(userId: number): boolean {
  return config.telegram.authorizedUsers.includes(userId);
}
