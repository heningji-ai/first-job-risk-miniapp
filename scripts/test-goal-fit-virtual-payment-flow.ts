function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
type Confirmation = { paymentAttemptId: string; orderId: string; status: "pending" | "paid" | "closed" | "review_required"; reportAvailable: boolean };
void (async () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const flow = require("../src/services/goal-fit-virtual-payment-flow") as typeof import("../src/services/goal-fit-virtual-payment-flow");
  const prepared = { orderId: "order_1", paymentAttemptId: "attempt_1", mode: "short_series_goods" as const, signData: "opaque-sign-data", paySig: "pay-sig", signature: "signature" };
  const pending: unknown[] = []; const clears: unknown[] = []; const delays: number[] = []; const calls: string[] = [];
  const base = (confirmations: Array<Confirmation | Error> = [{ ...prepared, paymentAttemptId: "attempt_1", status: "paid", reportAvailable: true } as Confirmation]) => ({
    supportCheck: () => true,
    loginCodeProvider: async () => { calls.push("login"); return "code"; },
    preparePayment: async (assessmentId: string, input: { code: string; requestId: string }) => { calls.push(`prepare:${assessmentId}:${input.code}`); return prepared; },
    invokePayment: async (params: unknown) => { calls.push("invoke"); assert(JSON.stringify(params) === JSON.stringify({ mode: prepared.mode, signData: prepared.signData, paySig: prepared.paySig, signature: prepared.signature }), "invoke gets raw params only"); },
    confirmPayment: async () => { calls.push("confirm"); const next = confirmations.shift(); if (next instanceof Error) throw next; return next as Confirmation; },
    fetchFullReport: async () => { calls.push("report"); return { full: "report" }; },
    savePending: (record: unknown) => { pending.push(record); return true; }, clearPending: () => { clears.push(true); },
    delayFn: async (milliseconds: number) => { delays.push(milliseconds); }, requestIdFactory: () => "req_test", now: () => 1000,
  });
  try {
    const unsupported = await flow.startGoalFitVirtualPaymentFlow({ assessmentId: "asm_1", dependencies: { ...base(), supportCheck: () => false } });
    assert(unsupported.status === "unsupported" && calls.length === 0, "unsupported skips login");
    const normal = await flow.startGoalFitVirtualPaymentFlow({ assessmentId: "asm_1", dependencies: base() });
    assert(normal.status === "paid" && normal.report && !Object.keys(normal).some((key) => ["requestId", "signData", "paySig", "signature"].includes(key)), "paid requires report and hides payment params");
    assert(JSON.stringify(pending[0]) === JSON.stringify({ assessmentId: "asm_1", paymentAttemptId: "attempt_1", createdAt: 1000 }) && clears.length === 1, "save before invoke and clear after report");
    assert(calls.join(",") === "login,prepare:asm_1:code,invoke,confirm,report", "normal sequence");

    calls.length = pending.length = clears.length = delays.length = 0;
    const pendingResult = await flow.startGoalFitVirtualPaymentFlow({ assessmentId: "asm_1", dependencies: base(Array.from({ length: 5 }, () => ({ paymentAttemptId: "attempt_1", orderId: "order", status: "pending" as const, reportAvailable: false }))) });
    assert(pendingResult.status === "pending" && clears.length === 0 && calls.filter((item) => item === "confirm").length === 5, "five pending confirmations retain storage");
    assert(JSON.stringify(delays) === JSON.stringify([1000, 2000, 4000, 8000]), "fixed polling delays");

    for (const [status, expected] of [["closed", "closed"], ["review_required", "review_required"]] as const) {
      clears.length = 0; calls.length = 0;
      const outcome = await flow.startGoalFitVirtualPaymentFlow({ assessmentId: "asm_1", dependencies: base([{ paymentAttemptId: "attempt_1", orderId: "order", status, reportAvailable: false }]) });
      assert(outcome.status === expected && clears.length === 1 && !calls.includes("report"), `${status} clears without report`);
    }
    calls.length = clears.length = 0;
    const network = await flow.startGoalFitVirtualPaymentFlow({ assessmentId: "asm_1", dependencies: base([new Error("network"), new Error("network"), new Error("network"), new Error("network"), new Error("network")]) });
    assert(network.status === "pending" && clears.length === 0, "network failures become recoverable pending");
    calls.length = clears.length = 0;
    const reportFailure = await flow.startGoalFitVirtualPaymentFlow({ assessmentId: "asm_1", dependencies: { ...base(), fetchFullReport: async () => { throw new Error("temporary"); } } });
    assert(reportFailure.status === "failed" && reportFailure.safeCode === "FULL_REPORT_UNAVAILABLE" && clears.length === 0, "report failure retains pending");
    calls.length = clears.length = 0;
    const alreadyPurchased = await flow.startGoalFitVirtualPaymentFlow({ assessmentId: "asm_1", dependencies: { ...base(), preparePayment: async () => { throw new Error("ALREADY_PURCHASED"); } } });
    assert(alreadyPurchased.status === "paid" && alreadyPurchased.report && calls.includes("report") && !calls.includes("invoke"), "ALREADY_PURCHASED recovers the authoritative report without invoking payment");
    calls.length = clears.length = 0;
    let active = true;
    const stale = await flow.startGoalFitVirtualPaymentFlow({ assessmentId: "asm_1", dependencies: { ...base(), isFlowActive: () => active, fetchFullReport: async () => { active = false; return { secret: "old" }; } } });
    assert(stale.safeCode === "PAYMENT_FLOW_STALE" && clears.length === 0, "stale response cannot clear a newer pending record");
    calls.length = clears.length = 0;
    const cancelled = await flow.startGoalFitVirtualPaymentFlow({ assessmentId: "asm_1", dependencies: { ...base(), invokePayment: async () => { throw { kind: "cancelled", errMsg: "hidden" }; } } });
    assert(cancelled.status === "cancelled" && clears.length === 1 && !calls.includes("confirm"), "cancel does not confirm");
    calls.length = clears.length = 0;
    const uncertain = await flow.startGoalFitVirtualPaymentFlow({ assessmentId: "asm_1", dependencies: { ...base(), invokePayment: async () => { throw { kind: "uncertain" }; } } });
    assert(uncertain.status === "paid" && calls.includes("confirm"), "uncertain confirms");
    for (const kind of ["session_key_expired", "rate_limited", "configuration_error", "risk_blocked"] as const) {
      calls.length = clears.length = 0;
      const outcome = await flow.startGoalFitVirtualPaymentFlow({ assessmentId: "asm_1", dependencies: { ...base(), invokePayment: async () => { throw { kind, errMsg: "hidden" }; } } });
      assert(outcome.status === "failed" && outcome.failureKind === kind && clears.length === 1 && !calls.includes("confirm"), `${kind} is explicit failure`);
    }
    const bad = await flow.startGoalFitVirtualPaymentFlow({ assessmentId: "" });
    assert(bad.status === "failed" && bad.safeCode === "INVALID_ASSESSMENT_ID", "invalid assessment safe failure");
  } finally { /* injected dependencies own all resources */ }
  console.log("Goal Fit virtual payment flow tests passed.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
