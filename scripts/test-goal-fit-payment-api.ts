type RequestCall = { path: string; method?: string; data?: unknown; requiresMiniappAuth?: boolean };

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

async function rejects(action: () => Promise<unknown>, code: string): Promise<void> {
  try {
    await action();
  } catch (error) {
    assert(error instanceof Error && error.message === code, `expected ${code}`);
    return;
  }
  throw new Error(`expected rejection ${code}`);
}

void (async () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const payment = require("../src/api/goal-fit-payment") as typeof import("../src/api/goal-fit-payment");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { ApiError, request } = require("../src/api/request") as typeof import("../src/api/request");
  const calls: RequestCall[] = [];
  const prepareResponse = {
    orderId: "order_123",
    paymentAttemptId: "attempt_123",
    mode: "short_series_goods" as const,
    signData: '{"opaque":"keep-as-string"}',
    paySig: "pay-sig",
    signature: "signature",
  };
  const fullReport = {
    targetCompany: "D", targetRole: "PM", targetCompanyLabel: "大厂", targetRoleLabel: "产品",
    scores: { overallScore: 80 }, overallConclusion: { title: "适配", summary: "说明" },
    companyQuadrant: { title: "公司", summary: "说明", advice: "建议" }, roleQuadrant: { title: "岗位", summary: "说明", advice: "建议" },
    riskInsights: [], headhunterSummary: "建议", recommendations: [], cards: [], resultVersion: "v1",
  };
  let response: unknown = { ...prepareResponse, unexpected: "discard" };
  const mockRequest = (async (options: RequestCall) => {
    calls.push(options);
    if (response instanceof Error) throw response;
    return response;
  }) as typeof request;

  payment.setGoalFitPaymentRequestClientForTest(mockRequest);
  try {
    const prepared = await payment.prepareGoalFitVirtualPayment("asm/a b", {
      code: "temporary-code",
      requestId: "request-1",
    });
    assert(prepared.signData === prepareResponse.signData, "signData must remain an opaque string");
    assert(JSON.stringify(prepared) === JSON.stringify(prepareResponse), "prepare must discard unknown response fields");
    assert(calls[0]?.path === "/api/miniapp/goal-fit/assessments/asm%2Fa%20b/virtual-payment-params", "prepare path must encode assessment id");
    assert(calls[0]?.method === "POST" && calls[0]?.requiresMiniappAuth === true, "prepare must be authenticated POST");
    assert(JSON.stringify(calls[0]?.data) === JSON.stringify({ code: "temporary-code", requestId: "request-1" }), "prepare body must only contain code and requestId");

    for (const invalid of [
      { ...prepareResponse, mode: "other" },
      { ...prepareResponse, signData: "" },
      { ...prepareResponse, paySig: "" },
      { ...prepareResponse, signature: "" },
    ]) {
      response = invalid;
      await rejects(() => payment.prepareGoalFitVirtualPayment("asm_1", { code: "code", requestId: "request" }), "INVALID_VIRTUAL_PAYMENT_RESPONSE");
    }

    for (const confirmation of [
      { paymentAttemptId: "attempt_1", orderId: "order_1", status: "pending" as const, reportAvailable: false },
      { paymentAttemptId: "attempt_1", orderId: "order_1", status: "paid" as const, reportAvailable: true },
      { paymentAttemptId: "attempt_1", orderId: "order_1", status: "closed" as const, reportAvailable: false },
      { paymentAttemptId: "attempt_1", orderId: "order_1", status: "review_required" as const, reportAvailable: false },
    ]) {
      response = confirmation;
      assert((await payment.confirmGoalFitVirtualPayment("attempt/a b")).status === confirmation.status, "confirmation status must parse");
    }
    assert(calls.at(-1)?.path === "/api/miniapp/goal-fit/payment-attempts/attempt%2Fa%20b/confirm", "confirmation path must encode id");
    assert(calls.at(-1)?.method === "POST" && JSON.stringify(calls.at(-1)?.data) === "{}", "confirmation body must be empty");
    response = { paymentAttemptId: "attempt", orderId: "order", status: "unknown", reportAvailable: false };
    await rejects(() => payment.confirmGoalFitVirtualPayment("attempt"), "INVALID_PAYMENT_CONFIRMATION_RESPONSE");
    response = { paymentAttemptId: "attempt", orderId: "order", status: "paid", reportAvailable: false };
    await rejects(() => payment.confirmGoalFitVirtualPayment("attempt"), "INVALID_PAYMENT_CONFIRMATION_RESPONSE");

    response = { assessmentId: "asm/a b", reportSnapshotId: "rpt_1", fullReport };
    assert((await payment.fetchGoalFitFullReport("asm/a b")).fullReport === fullReport, "full report response must preserve the server wrapper");
    assert(calls.at(-1)?.path === "/api/miniapp/goal-fit/assessments/asm%2Fa%20b/full-report" && calls.at(-1)?.method === undefined, "full report must use encoded GET path");

    response = { purchase: { assessmentId: "asm_1", reportSnapshotId: "rpt_1", status: "ACTIVE", unlocked: true, fullReport } };
    assert((await payment.fetchLatestGoalFitPurchase()).purchase?.assessmentId === "asm_1", "latest purchase must preserve active entitlement report");
    assert(calls.at(-1)?.path === "/api/miniapp/goal-fit/purchases/latest", "latest purchase must use the protected recovery endpoint");

    response = { purchase: { assessmentId: "asm_refunded_123456", reportSnapshotId: "rpt_1", status: "REFUNDED", unlocked: false, revokedAt: "2026-07-29T00:00:00.000Z", fullReport: null } };
    const refunded = await payment.fetchLatestGoalFitPurchase();
    assert(refunded.purchase?.status === "REFUNDED" && refunded.purchase.unlocked === false, "latest purchase must preserve the refunded entitlement contract without report content");

    const validPurchase = { assessmentId: "asm_purchase_123456", reportSnapshotId: "rpt_purchase_123456", reportType: "goal_fit", reportTypeTitle: "报告", companyType: "互联网", roleName: "产品", completedAt: "2026-07-30T00:00:00.000Z", primaryConclusion: null, status: "ACTIVE", unlocked: true, revokedAt: null, copyVersion: null, mappingVersion: null };
    response = { purchases: [validPurchase, { ...validPurchase, assessmentId: "assessment_local_only" }] };
    const partialPurchases = await payment.fetchGoalFitPurchases();
    assert(partialPurchases.purchases.length === 1 && partialPurchases.purchases[0]?.assessmentId === validPurchase.assessmentId, "one malformed historical item must not hide valid reports");
    assert(partialPurchases.partialContractError?.invalidItemIndex === 1 && partialPurchases.partialContractError.invalidFieldNames.includes("assessmentId") && partialPurchases.partialContractError.invalidFieldTypeMap.assessmentId === "string" && partialPurchases.partialContractError.invalidAssessmentIdSuffix === "l_only" && partialPurchases.partialContractError.invalidReportSnapshotIdSuffix === "123456" && partialPurchases.partialContractError.validItemCount === 1 && partialPurchases.partialContractError.invalidItemCount === 1, "partial diagnostics must use only suffixes, field names, field types, and item counts");
    response = { purchases: [{ ...validPurchase, assessmentId: "assessment_local_only" }] };
    try { await payment.fetchGoalFitPurchases(); throw new Error("all malformed purchases must fail"); } catch (error) { assert(error instanceof payment.GoalFitPurchasesContractError && error.parserStage === "purchase_item" && error.issue?.totalItemCount === 1, "all malformed purchases must expose safe item diagnostics"); }

    response = new ApiError("FULL_REPORT_REFUNDED", { statusCode: 403 });
    await rejects(() => payment.fetchGoalFitFullReport("asm_refunded_123456"), "FULL_REPORT_REFUNDED");

    const callCount = calls.length;
    await rejects(() => payment.prepareGoalFitVirtualPayment("", { code: "code", requestId: "request" }), "INVALID_VIRTUAL_PAYMENT_RESPONSE");
    await rejects(() => payment.prepareGoalFitVirtualPayment("asm", { code: "", requestId: "request" }), "INVALID_VIRTUAL_PAYMENT_RESPONSE");
    await rejects(() => payment.confirmGoalFitVirtualPayment(""), "INVALID_PAYMENT_CONFIRMATION_RESPONSE");
    await rejects(() => payment.fetchGoalFitFullReport(""), "INVALID_FULL_REPORT_RESPONSE");
    assert(calls.length === callCount, "invalid input must not call the request layer");
  } finally {
    payment.setGoalFitPaymentRequestClientForTest();
  }

  console.log("Goal Fit virtual payment API client tests passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
