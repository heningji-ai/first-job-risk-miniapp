function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
type Deferred = { resolve: (value: any) => void; dependencies: any };
void (async () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const controller = require("../src/services/goal-fit-virtual-payment-controller") as typeof import("../src/services/goal-fit-virtual-payment-controller");
  const deferred: Deferred[] = []; let starts = 0; const states: unknown[] = [];
  const runner = (options: any) => new Promise((resolve) => { starts += 1; deferred.push({ resolve, dependencies: options.dependencies }); options.dependencies.onStateChange?.("invoking"); });
  const unsubscribe = controller.subscribeGoalFitVirtualPaymentState((state) => { states.push(state); if ((state as any).status === "invoking") throw new Error("listener failure"); });
  try {
    const first = controller.startManagedGoalFitVirtualPayment({ assessmentId: "asm_a", flowRunner: runner });
    const same = controller.startManagedGoalFitVirtualPayment({ assessmentId: "asm_a", flowRunner: runner });
    assert(first === same && starts === 1, "same assessment reuses promise");
    const ten = Array.from({ length: 10 }, () => controller.startManagedGoalFitVirtualPayment({ assessmentId: "asm_a", flowRunner: runner }));
    assert(ten.every((item) => item === first) && starts === 1, "ten clicks share one flow");
    const second = controller.startManagedGoalFitVirtualPayment({ assessmentId: "asm_b", flowRunner: runner });
    assert(starts === 2 && deferred[0]?.dependencies.isFlowActive() === false && deferred[1]?.dependencies.isFlowActive() === true, "assessment switch invalidates old flow");
    deferred[0]?.resolve({ status: "paid", assessmentId: "asm_a", report: { secret: "old" } });
    const oldResult = await first;
    assert(oldResult.safeCode === "PAYMENT_FLOW_STALE", "old result is discarded");
    assert(controller.getActiveGoalFitVirtualPaymentState().assessmentId === "asm_b" && controller.getActiveGoalFitVirtualPaymentState().busy, "old completion cannot clear new flow");
    deferred[1]?.resolve({ status: "pending", assessmentId: "asm_b", safeCode: "CONFIRMATION_PENDING" });
    const secondResult = await second;
    assert(secondResult.status === "pending" && controller.getActiveGoalFitVirtualPaymentState().status === "pending", "current flow commits result");
    const safe = controller.getActiveGoalFitVirtualPaymentState() as Record<string, unknown>;
    assert(!["flowId", "requestId", "paymentAttemptId", "orderId", "report", "signData"].some((key) => key in safe), "state excludes sensitive fields");
    const third = controller.startManagedGoalFitVirtualPayment({ assessmentId: "asm_c", flowRunner: runner });
    controller.invalidateGoalFitVirtualPaymentFlow({ assessmentId: "asm_c" });
    assert(controller.getActiveGoalFitVirtualPaymentState().status === "idle", "invalidate safely resets state");
    deferred[2]?.resolve({ status: "paid", assessmentId: "asm_c", report: { secret: "new" } });
    assert((await third).safeCode === "PAYMENT_FLOW_STALE", "invalidated flow cannot commit");
    const count = states.length; unsubscribe(); unsubscribe();
    controller.startManagedGoalFitVirtualPayment({ assessmentId: "asm_d", flowRunner: runner });
    assert(states.length === count, "unsubscribe is idempotent");
    controller.invalidateGoalFitVirtualPaymentFlow(); deferred[3]?.resolve({ status: "failed", assessmentId: "asm_d" });
  } finally { controller.invalidateGoalFitVirtualPaymentFlow(); }
  console.log("Goal Fit virtual payment controller tests passed.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
