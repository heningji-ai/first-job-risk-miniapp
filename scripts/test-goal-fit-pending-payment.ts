function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

const key = "goal_fit_pending_virtual_payment_v1";
const originalUni = (globalThis as Record<string, unknown>).uni;
const storage = new Map<string, unknown>();
let readFails = false;
let writeFails = false;

void (async () => {
  (globalThis as Record<string, unknown>).uni = {
    getStorageSync(name: string) { if (readFails) throw new Error("read failure"); return storage.get(name); },
    setStorageSync(name: string, value: unknown) { if (writeFails) throw new Error("write failure"); storage.set(name, value); },
    removeStorageSync(name: string) { storage.delete(name); },
  };
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pending = require("../src/storage/goal-fit-pending-payment") as typeof import("../src/storage/goal-fit-pending-payment");
  const now = 1_800_000_000_000;
  const good = { assessmentId: "asm_1", paymentAttemptId: "attempt_1", createdAt: now };
  const invalid = async (value: unknown, message: string) => {
    storage.set(key, value);
    assert(pending.getPendingGoalFitPaymentConfirmation({ now }) === null && !storage.has(key), message);
  };
  try {
    const originalNow = Date.now;
    Date.now = () => now;
    try {
      assert(pending.savePendingGoalFitPaymentConfirmation({ assessmentId: good.assessmentId, paymentAttemptId: good.paymentAttemptId }), "valid record saves");
      assert(JSON.stringify(storage.get(key)) === JSON.stringify(good), "only three fields save with default timestamp");
      assert(JSON.stringify(pending.getPendingGoalFitPaymentConfirmation({ now })) === JSON.stringify(good), "valid record reads");
      pending.clearPendingGoalFitPaymentConfirmation();
      pending.clearPendingGoalFitPaymentConfirmation();
      assert(!storage.has(key) && pending.getPendingGoalFitPaymentConfirmation({ now }) === null, "clear is idempotent and missing is null");
      storage.set(key, good);
      assert(pending.getPendingGoalFitPaymentConfirmation({ assessmentId: "asm_other", now }) === null && !storage.has(key), "mismatch clears");
      await invalid({ ...good, createdAt: now - pending.GOAL_FIT_PENDING_PAYMENT_TTL_MS }, "exact TTL expires");
      await invalid({ ...good, createdAt: now - pending.GOAL_FIT_PENDING_PAYMENT_TTL_MS - 1 }, "older record expires");
      storage.set(key, { ...good, createdAt: now + 5 * 60 * 1000 });
      assert(pending.getPendingGoalFitPaymentConfirmation({ now })?.createdAt === now + 5 * 60 * 1000, "five-minute skew allowed");
      await invalid({ ...good, createdAt: now + 5 * 60 * 1000 + 1 }, "future record clears");
      for (const input of [
        { assessmentId: "", paymentAttemptId: "attempt_1" },
        { assessmentId: "asm_1", paymentAttemptId: "" },
        { assessmentId: "a".repeat(129), paymentAttemptId: "attempt_1" },
        { assessmentId: "asm_1", paymentAttemptId: "a".repeat(129) },
        { assessmentId: "asm_1", paymentAttemptId: "attempt_1", createdAt: 0 },
        { assessmentId: "asm_1", paymentAttemptId: "attempt_1", createdAt: Number.NaN },
      ]) assert(!pending.savePendingGoalFitPaymentConfirmation(input), "invalid save rejects safely");
      for (const corrupt of ["text", [], {}, { assessmentId: "asm_1", paymentAttemptId: "attempt_1" }, { ...good, assessmentId: 1 }, { ...good, unexpected: true }, { ...good, signData: "secret" }, { ...good, paySig: "secret" }, { ...good, signature: "secret" }]) await invalid(corrupt, "corrupt record clears");
      readFails = true;
      assert(pending.getPendingGoalFitPaymentConfirmation({ now }) === null, "read failure degrades safely");
      readFails = false;
      writeFails = true;
      assert(!pending.savePendingGoalFitPaymentConfirmation(good), "write failure returns false");
      writeFails = false;
    } finally {
      Date.now = originalNow;
    }
  } finally {
    if (originalUni === undefined) delete (globalThis as Record<string, unknown>).uni;
    else (globalThis as Record<string, unknown>).uni = originalUni;
  }
  console.log("Goal Fit pending payment storage tests passed.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
