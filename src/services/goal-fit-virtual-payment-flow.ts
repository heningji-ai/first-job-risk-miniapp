import {
  confirmGoalFitVirtualPayment,
  fetchGoalFitFullReport,
  prepareGoalFitVirtualPayment,
  type GoalFitPaymentConfirmation,
  type GoalFitVirtualPaymentParams,
} from "@/api/goal-fit-payment";
import {
  clearPendingGoalFitPaymentConfirmation,
  savePendingGoalFitPaymentConfirmation,
} from "@/storage/goal-fit-pending-payment";
import {
  invokeWechatVirtualPayment,
  isWechatVirtualPaymentSupported,
  requestWechatLoginCode,
  type WechatVirtualPaymentFailureKind,
  type WechatVirtualPaymentInvocationParams,
} from "@/services/wechat-virtual-payment";

export type GoalFitVirtualPaymentFlowStatus =
  | "idle" | "preparing" | "invoking" | "confirming" | "paid" | "pending"
  | "cancelled" | "closed" | "review_required" | "failed" | "unsupported";

export type GoalFitVirtualPaymentFlowSafeCode =
  | "INVALID_ASSESSMENT_ID" | "UNSUPPORTED" | "LOGIN_FAILED" | "PREPARE_FAILED"
  | "INVALID_PAYMENT_PARAMS" | "CANCELLED" | "SESSION_KEY_EXPIRED" | "RATE_LIMITED"
  | "CONFIGURATION_ERROR" | "RISK_BLOCKED" | "PAYMENT_FAILED" | "CONFIRMATION_PENDING"
  | "CONFIRMATION_FAILED" | "CLOSED" | "REVIEW_REQUIRED" | "FULL_REPORT_UNAVAILABLE"
  | "PAYMENT_FLOW_STALE" | "MINIAPP_AUTH_REQUIRED" | "MINIAPP_SESSION_EXPIRED";

export type GoalFitVirtualPaymentFlowResult<TReport = unknown> = {
  status: GoalFitVirtualPaymentFlowStatus;
  assessmentId: string;
  report?: TReport;
  failureKind?: WechatVirtualPaymentFailureKind;
  safeCode?: GoalFitVirtualPaymentFlowSafeCode;
};

export const GOAL_FIT_VIRTUAL_PAYMENT_CONFIRM_DELAYS_MS = [0, 1000, 2000, 4000, 8000] as const;

export type GoalFitVirtualPaymentFlowDependencies<TReport> = {
  supportCheck: () => boolean;
  loginCodeProvider: () => Promise<string>;
  preparePayment: (assessmentId: string, input: { code: string; requestId: string }) => Promise<GoalFitVirtualPaymentParams>;
  invokePayment: (params: WechatVirtualPaymentInvocationParams) => Promise<unknown>;
  confirmPayment: (paymentAttemptId: string) => Promise<GoalFitPaymentConfirmation>;
  fetchFullReport: (assessmentId: string) => Promise<TReport>;
  savePending: (record: { assessmentId: string; paymentAttemptId: string; createdAt?: number }) => boolean;
  clearPending: () => void;
  delayFn: (milliseconds: number) => Promise<void>;
  requestIdFactory: () => string;
  now: () => number;
  isFlowActive: () => boolean;
  onStateChange: (status: GoalFitVirtualPaymentFlowStatus) => void;
};

export type GoalFitVirtualPaymentFlowOptions<TReport = unknown> = {
  assessmentId: string;
  requestId?: string;
  dependencies?: Partial<GoalFitVirtualPaymentFlowDependencies<TReport>>;
};

function defaultDependencies<TReport>(): GoalFitVirtualPaymentFlowDependencies<TReport> {
  return {
    supportCheck: isWechatVirtualPaymentSupported,
    loginCodeProvider: requestWechatLoginCode,
    preparePayment: prepareGoalFitVirtualPayment,
    invokePayment: invokeWechatVirtualPayment,
    confirmPayment: confirmGoalFitVirtualPayment,
    fetchFullReport: fetchGoalFitFullReport as () => Promise<TReport>,
    savePending: savePendingGoalFitPaymentConfirmation,
    clearPending: clearPendingGoalFitPaymentConfirmation,
    delayFn: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    requestIdFactory: () => `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 14)}`,
    now: Date.now,
    isFlowActive: () => true,
    onStateChange: () => undefined,
  };
}

function validAssessmentId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 128;
}

function result<TReport>(status: GoalFitVirtualPaymentFlowStatus, assessmentId: string, extra: Omit<GoalFitVirtualPaymentFlowResult<TReport>, "status" | "assessmentId"> = {}): GoalFitVirtualPaymentFlowResult<TReport> {
  return { status, assessmentId, ...extra };
}

function safeFailure<TReport>(assessmentId: string, kind: WechatVirtualPaymentFailureKind): GoalFitVirtualPaymentFlowResult<TReport> {
  const mapping: Record<WechatVirtualPaymentFailureKind, [GoalFitVirtualPaymentFlowStatus, GoalFitVirtualPaymentFlowSafeCode]> = {
    cancelled: ["cancelled", "CANCELLED"],
    uncertain: ["pending", "CONFIRMATION_PENDING"],
    session_key_expired: ["failed", "SESSION_KEY_EXPIRED"],
    rate_limited: ["failed", "RATE_LIMITED"],
    configuration_error: ["failed", "CONFIGURATION_ERROR"],
    risk_blocked: ["failed", "RISK_BLOCKED"],
    failed: ["failed", "PAYMENT_FAILED"],
    unsupported: ["unsupported", "UNSUPPORTED"],
    invalid_params: ["failed", "INVALID_PAYMENT_PARAMS"],
  };
  const [status, safeCode] = mapping[kind];
  return result(status, assessmentId, { failureKind: kind, safeCode });
}

function failureKind(error: unknown): WechatVirtualPaymentFailureKind | null {
  const value = error as { kind?: unknown };
  return typeof value?.kind === "string" && ["cancelled", "uncertain", "session_key_expired", "rate_limited", "configuration_error", "risk_blocked", "failed", "unsupported", "invalid_params"].includes(value.kind)
    ? value.kind as WechatVirtualPaymentFailureKind
    : null;
}

function stale<TReport>(assessmentId: string): GoalFitVirtualPaymentFlowResult<TReport> {
  return result("failed", assessmentId, { safeCode: "PAYMENT_FLOW_STALE" });
}

export async function confirmAndLoadGoalFitVirtualPayment<TReport>(assessmentId: string, paymentAttemptId: string, dependencies: GoalFitVirtualPaymentFlowDependencies<TReport>): Promise<GoalFitVirtualPaymentFlowResult<TReport>> {
  dependencies.onStateChange("confirming");
  for (const [index, delay] of GOAL_FIT_VIRTUAL_PAYMENT_CONFIRM_DELAYS_MS.entries()) {
    if (delay > 0) await dependencies.delayFn(delay);
    if (!dependencies.isFlowActive()) return stale(assessmentId);
    let confirmation: GoalFitPaymentConfirmation;
    try {
      confirmation = await dependencies.confirmPayment(paymentAttemptId);
    } catch (error) {
      if ((error as Error)?.message?.startsWith("INVALID_PAYMENT_CONFIRMATION_RESPONSE")) {
        return result("failed", assessmentId, { safeCode: "CONFIRMATION_FAILED" });
      }
      if (index === GOAL_FIT_VIRTUAL_PAYMENT_CONFIRM_DELAYS_MS.length - 1) return result("pending", assessmentId, { safeCode: "CONFIRMATION_PENDING" });
      continue;
    }
    if (!dependencies.isFlowActive()) return stale(assessmentId);
    if (confirmation.status === "pending") {
      if (index === GOAL_FIT_VIRTUAL_PAYMENT_CONFIRM_DELAYS_MS.length - 1) return result("pending", assessmentId, { safeCode: "CONFIRMATION_PENDING" });
      continue;
    }
    if (confirmation.status === "closed") { dependencies.clearPending(); return result("closed", assessmentId, { safeCode: "CLOSED" }); }
    if (confirmation.status === "review_required") { dependencies.clearPending(); return result("review_required", assessmentId, { safeCode: "REVIEW_REQUIRED" }); }
    try {
      const report = await dependencies.fetchFullReport(assessmentId);
      if (!dependencies.isFlowActive()) return stale(assessmentId);
      dependencies.clearPending();
      return result("paid", assessmentId, { report });
    } catch {
      return result("failed", assessmentId, { safeCode: "FULL_REPORT_UNAVAILABLE" });
    }
  }
  return result("pending", assessmentId, { safeCode: "CONFIRMATION_PENDING" });
}

export async function startGoalFitVirtualPaymentFlow<TReport = unknown>(options: GoalFitVirtualPaymentFlowOptions<TReport>): Promise<GoalFitVirtualPaymentFlowResult<TReport>> {
  const assessmentId = options.assessmentId;
  if (!validAssessmentId(assessmentId)) return result("failed", String(assessmentId ?? ""), { safeCode: "INVALID_ASSESSMENT_ID" });
  const dependencies = { ...defaultDependencies<TReport>(), ...options.dependencies };
  if (!dependencies.supportCheck() || !dependencies.isFlowActive()) return result("unsupported", assessmentId, { safeCode: "UNSUPPORTED" });
  dependencies.onStateChange("preparing");
  let code: string;
  try { code = await dependencies.loginCodeProvider(); } catch { return result("failed", assessmentId, { safeCode: "LOGIN_FAILED" }); }
  if (!dependencies.isFlowActive()) return stale(assessmentId);
  let prepared: GoalFitVirtualPaymentParams;
  try { prepared = await dependencies.preparePayment(assessmentId, { code, requestId: options.requestId ?? dependencies.requestIdFactory() }); } catch (error) {
    if ((error as Error)?.message === "ALREADY_PURCHASED") {
      try {
        const report = await dependencies.fetchFullReport(assessmentId);
        return result("paid", assessmentId, { report });
      } catch { return result("failed", assessmentId, { safeCode: "FULL_REPORT_UNAVAILABLE" }); }
    }
    return result("failed", assessmentId, { safeCode: "PREPARE_FAILED" });
  }
  if (!dependencies.isFlowActive()) return stale(assessmentId);
  dependencies.savePending({ assessmentId, paymentAttemptId: prepared.paymentAttemptId, createdAt: dependencies.now() });
  if (!dependencies.isFlowActive()) return stale(assessmentId);
  dependencies.onStateChange("invoking");
  try {
    await dependencies.invokePayment({ mode: prepared.mode, signData: prepared.signData, paySig: prepared.paySig, signature: prepared.signature });
  } catch (error) {
    if (!dependencies.isFlowActive()) return stale(assessmentId);
    const kind = failureKind(error) ?? "failed";
    if (kind === "uncertain") return confirmAndLoadGoalFitVirtualPayment(assessmentId, prepared.paymentAttemptId, dependencies);
    const failed = safeFailure<TReport>(assessmentId, kind);
    dependencies.clearPending();
    return failed;
  }
  if (!dependencies.isFlowActive()) return stale(assessmentId);
  return confirmAndLoadGoalFitVirtualPayment(assessmentId, prepared.paymentAttemptId, dependencies);
}
