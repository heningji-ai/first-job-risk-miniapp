import { ApiError, request } from "@/api/request";

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

export async function fetchGoalFitFullReport<T = unknown>(assessmentId: string): Promise<T> {
  const response = await paymentRequestClient<unknown>({
    path: `/api/miniapp/goal-fit/assessments/${encodeRequiredId(assessmentId, "INVALID_FULL_REPORT_RESPONSE")}/full-report`,
    requiresMiniappAuth: true,
  });

  if (response === null || typeof response !== "object") {
    throw new GoalFitPaymentContractError("INVALID_FULL_REPORT_RESPONSE");
  }

  return response as T;
}
