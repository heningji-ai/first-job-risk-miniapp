const KEY = "goal_fit_pending_virtual_payment_v1";
const MAX_ID_LENGTH = 128;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

export const GOAL_FIT_PENDING_PAYMENT_TTL_MS = 24 * 60 * 60 * 1000;

export interface PendingGoalFitPaymentConfirmation {
  assessmentId: string;
  paymentAttemptId: string;
  createdAt: number;
}

export interface PendingGoalFitPaymentReadOptions {
  assessmentId?: string;
  now?: number;
}

function warn(): void {
  if (import.meta.env.DEV) {
    console.warn("[goal fit pending payment] storage unavailable");
  }
}

function isValidId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= MAX_ID_LENGTH;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function isValidTimestamp(value: unknown, now: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= now + MAX_FUTURE_SKEW_MS;
}

function parsePendingPayment(value: unknown, now: number): PendingGoalFitPaymentConfirmation | null {
  if (!isPlainObject(value)) return null;
  const keys = Object.keys(value).sort();
  if (keys.length !== 3 || keys.join(",") !== "assessmentId,createdAt,paymentAttemptId") return null;
  if (!isValidId(value.assessmentId) || !isValidId(value.paymentAttemptId) || !isValidTimestamp(value.createdAt, now)) return null;
  if (now - value.createdAt >= GOAL_FIT_PENDING_PAYMENT_TTL_MS) return null;
  return { assessmentId: value.assessmentId, paymentAttemptId: value.paymentAttemptId, createdAt: value.createdAt };
}

function clearSafely(): void {
  try {
    uni.removeStorageSync(KEY);
  } catch {
    warn();
  }
}

export function savePendingGoalFitPaymentConfirmation(input: {
  assessmentId: string;
  paymentAttemptId: string;
  createdAt?: number;
}): boolean {
  const createdAt = input.createdAt ?? Date.now();
  if (!isValidId(input.assessmentId) || !isValidId(input.paymentAttemptId) || !isValidTimestamp(createdAt, Date.now())) return false;

  const record: PendingGoalFitPaymentConfirmation = {
    assessmentId: input.assessmentId,
    paymentAttemptId: input.paymentAttemptId,
    createdAt,
  };
  try {
    uni.setStorageSync(KEY, record);
    return true;
  } catch {
    warn();
    return false;
  }
}

export function getPendingGoalFitPaymentConfirmation(
  options: PendingGoalFitPaymentReadOptions = {},
): PendingGoalFitPaymentConfirmation | null {
  const now = options.now ?? Date.now();
  if (!Number.isSafeInteger(now) || now <= 0) return null;
  try {
    const raw = uni.getStorageSync(KEY);
    const value = typeof raw === "string" ? JSON.parse(raw) : raw;
    const record = parsePendingPayment(value, now);
    if (!record || (options.assessmentId !== undefined && record.assessmentId !== options.assessmentId)) {
      if (raw !== undefined && raw !== null && raw !== "") clearSafely();
      return null;
    }
    return record;
  } catch {
    warn();
    clearSafely();
    return null;
  }
}

export function clearPendingGoalFitPaymentConfirmation(): void {
  clearSafely();
}
