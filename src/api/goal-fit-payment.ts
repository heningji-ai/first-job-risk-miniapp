import { ApiError, request } from "@/api/request";
import type { GoalFitResult } from "@/domain/goal-fit/types";
import type { GoalFitApiError, GoalFitFreeResultResponse, GoalFitFullReportResponse, GoalFitLatestPurchase, GoalFitPurchaseListItem, GoalFitPurchaseListResponse } from "@/types/goal-fit-report-conversion";
export type { GoalFitFullReportResponse, GoalFitFreeResultResponse, GoalFitLatestPurchase, GoalFitPurchaseListItem, GoalFitPurchaseListResponse } from "@/types/goal-fit-report-conversion";

type PaymentRequestClient = typeof request;

export type GoalFitVirtualPaymentParams = {
  orderId: string;
  paymentAttemptId: string;
  mode: "short_series_goods";
  signData: string;
  paySig: string;
  signature: string;
};

export type GoalFitPaymentConfirmation = {
  paymentAttemptId: string;
  orderId: string;
  status: "pending" | "paid" | "closed" | "review_required";
  reportAvailable: boolean;
  assessmentId?: string;
};

export type LatestGoalFitPurchaseResponse = { purchase: GoalFitLatestPurchase | null };

type PaymentContractErrorCode =
  | "INVALID_VIRTUAL_PAYMENT_RESPONSE"
  | "INVALID_PAYMENT_CONFIRMATION_RESPONSE"
  | "INVALID_FULL_REPORT_RESPONSE";

export class GoalFitPaymentContractError extends ApiError {
  constructor(code: PaymentContractErrorCode) {
    super(code);
    this.name = "GoalFitPaymentContractError";
  }
}

let paymentRequestClient: PaymentRequestClient = request;

/** Test-only seam; production always uses the shared request client. */
export function setGoalFitPaymentRequestClientForTest(client?: PaymentRequestClient): void {
  paymentRequestClient = client ?? request;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isOfficialAssessmentId(value: unknown): value is string {
  return typeof value === "string" && /^asm_[A-Za-z0-9_-]{8,}$/.test(value);
}

function isOptionalString(value: unknown): value is string | null {
  return value === null || isNonEmptyString(value);
}

function isPurchaseListItem(value: unknown): value is GoalFitPurchaseListItem {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return isOfficialAssessmentId(item.assessmentId)
    && isNonEmptyString(item.reportSnapshotId)
    && isNonEmptyString(item.reportType)
    && isOptionalString(item.reportTypeTitle)
    && isNonEmptyString(item.companyType)
    && isNonEmptyString(item.roleName)
    && isNonEmptyString(item.completedAt)
    && !Number.isNaN(Date.parse(item.completedAt))
    && isOptionalString(item.primaryConclusion)
    && ["ACTIVE", "REFUNDED", "REVOKED"].includes(String(item.status))
    && typeof item.unlocked === "boolean"
    && ((item.status === "ACTIVE" && item.unlocked === true) || (item.status !== "ACTIVE" && item.unlocked === false))
    && (item.revokedAt === null || isNonEmptyString(item.revokedAt))
    && isOptionalString(item.copyVersion)
    && isOptionalString(item.mappingVersion);
}

function encodeRequiredId(value: string, code: PaymentContractErrorCode): string {
  if (!isNonEmptyString(value)) {
    throw new GoalFitPaymentContractError(code);
  }

  return encodeURIComponent(value);
}

export async function prepareGoalFitVirtualPayment(
  assessmentId: string,
  input: { code: string; requestId: string },
): Promise<GoalFitVirtualPaymentParams> {
  if (!isNonEmptyString(input.code) || !isNonEmptyString(input.requestId)) {
    throw new GoalFitPaymentContractError("INVALID_VIRTUAL_PAYMENT_RESPONSE");
  }

  const response = await paymentRequestClient<unknown, { code: string; requestId: string }>({
    path: `/api/miniapp/goal-fit/assessments/${encodeRequiredId(assessmentId, "INVALID_VIRTUAL_PAYMENT_RESPONSE")}/virtual-payment-params`,
    method: "POST",
    data: { code: input.code, requestId: input.requestId },
    requiresMiniappAuth: true,
  });
  const value = response as Partial<GoalFitVirtualPaymentParams>;

  if (
    !isNonEmptyString(value.orderId) ||
    !isNonEmptyString(value.paymentAttemptId) ||
    value.mode !== "short_series_goods" ||
    !isNonEmptyString(value.signData) ||
    !isNonEmptyString(value.paySig) ||
    !isNonEmptyString(value.signature)
  ) {
    throw new GoalFitPaymentContractError("INVALID_VIRTUAL_PAYMENT_RESPONSE");
  }

  return {
    orderId: value.orderId,
    paymentAttemptId: value.paymentAttemptId,
    mode: value.mode,
    signData: value.signData,
    paySig: value.paySig,
    signature: value.signature,
  };
}

export async function confirmGoalFitVirtualPayment(
  paymentAttemptId: string,
): Promise<GoalFitPaymentConfirmation> {
  const response = await paymentRequestClient<unknown, Record<string, never>>({
    path: `/api/miniapp/goal-fit/payment-attempts/${encodeRequiredId(paymentAttemptId, "INVALID_PAYMENT_CONFIRMATION_RESPONSE")}/confirm`,
    method: "POST",
    data: {},
    requiresMiniappAuth: true,
  });
  const value = response as Partial<GoalFitPaymentConfirmation>;
  const validStatus = ["pending", "paid", "closed", "review_required"] as const;

  if (
    !isNonEmptyString(value.paymentAttemptId) ||
    !isNonEmptyString(value.orderId) ||
    !validStatus.includes(value.status as (typeof validStatus)[number]) ||
    typeof value.reportAvailable !== "boolean" ||
    (value.status === "paid" && !value.reportAvailable) ||
    (value.assessmentId !== undefined && !isNonEmptyString(value.assessmentId))
  ) {
    throw new GoalFitPaymentContractError("INVALID_PAYMENT_CONFIRMATION_RESPONSE");
  }

  return {
    paymentAttemptId: value.paymentAttemptId,
    orderId: value.orderId,
    status: value.status as GoalFitPaymentConfirmation["status"],
    reportAvailable: value.reportAvailable,
    ...(value.assessmentId === undefined ? {} : { assessmentId: value.assessmentId }),
  };
}

function isFullReportResponse(value: unknown): value is GoalFitFullReportResponse {
  const item = value as Partial<GoalFitFullReportResponse>;
  const report = item.fullReport as unknown as Record<string, unknown> | undefined;
  const legacy = report as { scores?: { overallScore?: unknown }; overallConclusion?: { title?: unknown }; riskInsights?: unknown; recommendations?: unknown; cards?: unknown } | undefined;
  return isNonEmptyString(item?.assessmentId)
    && isNonEmptyString(item.reportSnapshotId)
    && Boolean(report && typeof report === "object" && (Boolean(report.reportConversion) || (typeof legacy?.scores?.overallScore === "number" && isNonEmptyString(legacy.overallConclusion?.title) && Array.isArray(legacy.riskInsights) && Array.isArray(legacy.recommendations) && Array.isArray(legacy.cards))));
}

function isLatestPurchase(value: unknown): value is GoalFitLatestPurchase {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  if (item.status === "ACTIVE" && item.unlocked === true) return isFullReportResponse(item);
  return item.status === "REFUNDED"
    && item.unlocked === false
    && isOfficialAssessmentId(item.assessmentId)
    && isNonEmptyString(item.reportSnapshotId)
    && item.fullReport === null
    && (item.revokedAt === null || isNonEmptyString(item.revokedAt) || item.refundedAt === null || isNonEmptyString(item.refundedAt));
}

export class GoalFitReportAccessError extends ApiError { constructor(readonly code: GoalFitApiError, statusCode: number) { super(code, { statusCode }); this.name = "GoalFitReportAccessError"; } }

function translateReportError(error: unknown): never {
  if (error instanceof ApiError && (error.message === "FULL_REPORT_NOT_ENTITLED" || error.message === "FULL_REPORT_TEMPORARY_UNAVAILABLE" || error.message === "FULL_REPORT_REFUNDED")) throw new GoalFitReportAccessError(error.message, error.statusCode ?? 0);
  throw error;
}

export async function fetchGoalFitFreeResult(assessmentId: string): Promise<GoalFitFreeResultResponse> {
  try {
    const response = await paymentRequestClient<unknown>({ path: `/api/miniapp/goal-fit/assessments/${encodeRequiredId(assessmentId, "INVALID_FULL_REPORT_RESPONSE")}/free-result`, requiresMiniappAuth: true });
    const value = response as GoalFitFreeResultResponse;
    if (!isNonEmptyString(value?.assessmentId) || !isNonEmptyString(value.reportSnapshotId) || !value.freeResult || typeof value.freeResult.overallScore !== "number") throw new GoalFitPaymentContractError("INVALID_FULL_REPORT_RESPONSE");
    return value;
  } catch (error) { return translateReportError(error); }
}

export async function fetchGoalFitFullReport(assessmentId: string): Promise<GoalFitFullReportResponse> {
 try { const response = await paymentRequestClient<unknown>({
    path: `/api/miniapp/goal-fit/assessments/${encodeRequiredId(assessmentId, "INVALID_FULL_REPORT_RESPONSE")}/full-report`,
    requiresMiniappAuth: true,
  });

  if (!isFullReportResponse(response)) {
    throw new GoalFitPaymentContractError("INVALID_FULL_REPORT_RESPONSE");
  }

  return response;
 } catch (error) { return translateReportError(error); }
}

export async function fetchLatestGoalFitPurchase(): Promise<LatestGoalFitPurchaseResponse> {
  const response = await paymentRequestClient<unknown>({
    path: "/api/miniapp/goal-fit/purchases/latest",
    requiresMiniappAuth: true,
  });
  const value = response as Partial<LatestGoalFitPurchaseResponse>;
  if (value.purchase !== null && !isLatestPurchase(value.purchase)) {
    throw new GoalFitPaymentContractError("INVALID_FULL_REPORT_RESPONSE");
  }
  return { purchase: value.purchase ?? null };
}

/** Lists only reports that the server has already marked as unlocked for this identity. */
export async function fetchGoalFitPurchases(): Promise<GoalFitPurchaseListResponse> {
  const response = await paymentRequestClient<unknown>({
    path: "/api/miniapp/goal-fit/purchases",
    requiresMiniappAuth: true,
  });
  if (!response || typeof response !== "object" || Array.isArray(response)) {
    throw new GoalFitPaymentContractError("INVALID_FULL_REPORT_RESPONSE");
  }
  const purchases = (response as Record<string, unknown>).purchases;
  if (!Array.isArray(purchases) || !purchases.every(isPurchaseListItem)) {
    throw new GoalFitPaymentContractError("INVALID_FULL_REPORT_RESPONSE");
  }
  return { purchases };
}
