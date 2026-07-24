import { confirmGoalFitVirtualPayment, fetchGoalFitFullReport } from "@/api/goal-fit-payment";
import { confirmAndLoadGoalFitVirtualPayment, type GoalFitVirtualPaymentFlowDependencies, type GoalFitVirtualPaymentFlowResult } from "@/services/goal-fit-virtual-payment-flow";
import { clearPendingGoalFitPaymentConfirmationIfMatches, getPendingGoalFitPaymentConfirmation } from "@/storage/goal-fit-pending-payment";

export async function resumeGoalFitVirtualPaymentConfirmation<TReport = unknown>(options: {
  assessmentId: string;
  dependencies?: Partial<GoalFitVirtualPaymentFlowDependencies<TReport>> & { getPending?: typeof getPendingGoalFitPaymentConfirmation; clearPendingIfMatches?: typeof clearPendingGoalFitPaymentConfirmationIfMatches };
}): Promise<GoalFitVirtualPaymentFlowResult<TReport> | null> {
  if (typeof options.assessmentId !== "string" || !options.assessmentId.trim()) return null;
  const getPending = options.dependencies?.getPending ?? getPendingGoalFitPaymentConfirmation;
  const record = getPending({ assessmentId: options.assessmentId });
  if (!record) return null;
  const clear = options.dependencies?.clearPendingIfMatches ?? clearPendingGoalFitPaymentConfirmationIfMatches;
  const deps: GoalFitVirtualPaymentFlowDependencies<TReport> = {
    confirmPayment: confirmGoalFitVirtualPayment,
    fetchFullReport: fetchGoalFitFullReport as () => Promise<TReport>,
    clearPending: () => { clear({ assessmentId: record.assessmentId, paymentAttemptId: record.paymentAttemptId }); },
    savePending: () => true, delayFn: async () => undefined, now: Date.now, requestIdFactory: () => "", supportCheck: () => true,
    loginCodeProvider: async () => "", preparePayment: async () => { throw new Error("unused"); }, invokePayment: async () => undefined,
    isFlowActive: () => true, onStateChange: () => undefined,
    ...options.dependencies,
  };
  if (!deps.isFlowActive()) return { status: "failed", assessmentId: options.assessmentId, safeCode: "PAYMENT_FLOW_STALE" };
  try {
    return await confirmAndLoadGoalFitVirtualPayment(options.assessmentId, record.paymentAttemptId, deps);
  } catch (error) {
    const code = error instanceof Error ? error.message : "CONFIRMATION_PENDING";
    return { status: "failed", assessmentId: options.assessmentId, safeCode: code === "MINIAPP_AUTH_REQUIRED" || code === "MINIAPP_SESSION_EXPIRED" ? code as "CONFIRMATION_FAILED" : "CONFIRMATION_PENDING" };
  }
}
