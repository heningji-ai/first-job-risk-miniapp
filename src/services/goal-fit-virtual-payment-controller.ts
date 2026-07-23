import {
  startGoalFitVirtualPaymentFlow,
  type GoalFitVirtualPaymentFlowDependencies,
  type GoalFitVirtualPaymentFlowResult,
  type GoalFitVirtualPaymentFlowStatus,
} from "@/services/goal-fit-virtual-payment-flow";

export interface GoalFitVirtualPaymentState {
  status: GoalFitVirtualPaymentFlowStatus | "idle";
  assessmentId?: string;
  busy: boolean;
  canRetry: boolean;
  failureKind?: string;
  safeCode?: string;
}

type FlowRunner = <TReport>(options: { assessmentId: string; dependencies: Partial<GoalFitVirtualPaymentFlowDependencies<TReport>> }) => Promise<GoalFitVirtualPaymentFlowResult<TReport>>;
type ActiveFlow = { flowId: string; assessmentId: string; invalidated: boolean; promise: Promise<GoalFitVirtualPaymentFlowResult> };

let active: ActiveFlow | null = null;
let state: GoalFitVirtualPaymentState = { status: "idle", busy: false, canRetry: true };
const listeners = new Set<(value: GoalFitVirtualPaymentState) => void>();

function emit(next: GoalFitVirtualPaymentState): void {
  state = next;
  for (const listener of listeners) {
    try { listener({ ...state }); } catch { /* listeners cannot affect payment */ }
  }
}

function validAssessmentId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 128;
}

function activeFor(flowId: string, assessmentId: string): boolean {
  return active?.flowId === flowId && active.assessmentId === assessmentId && !active.invalidated;
}

function safeState(result: GoalFitVirtualPaymentFlowResult): GoalFitVirtualPaymentState {
  return {
    status: result.status,
    assessmentId: result.assessmentId,
    busy: false,
    canRetry: !["paid", "pending", "review_required"].includes(result.status),
    ...(result.failureKind ? { failureKind: result.failureKind } : {}),
    ...(result.safeCode ? { safeCode: result.safeCode } : {}),
  };
}

function newFlowId(): string {
  return `flow_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

export function getActiveGoalFitVirtualPaymentState(): GoalFitVirtualPaymentState {
  return { ...state };
}

export function subscribeGoalFitVirtualPaymentState(listener: (value: GoalFitVirtualPaymentState) => void): () => void {
  try { listener({ ...state }); } catch { /* ignored */ }
  listeners.add(listener);
  let subscribed = true;
  return () => { if (subscribed) { subscribed = false; listeners.delete(listener); } };
}

export function invalidateGoalFitVirtualPaymentFlow(options: { assessmentId?: string } = {}): void {
  if (!active || (options.assessmentId !== undefined && active.assessmentId !== options.assessmentId)) return;
  active.invalidated = true;
  active = null;
  emit({ status: "idle", busy: false, canRetry: true });
}

export function startManagedGoalFitVirtualPayment<TReport = unknown>(options: {
  assessmentId: string;
  flowRunner?: FlowRunner;
}): Promise<GoalFitVirtualPaymentFlowResult<TReport>> {
  if (!validAssessmentId(options.assessmentId)) {
    return Promise.resolve({ status: "failed", assessmentId: "", safeCode: "INVALID_ASSESSMENT_ID" } as GoalFitVirtualPaymentFlowResult<TReport>);
  }
  if (active?.assessmentId === options.assessmentId && !active.invalidated) return active.promise as Promise<GoalFitVirtualPaymentFlowResult<TReport>>;
  if (active) invalidateGoalFitVirtualPaymentFlow();
  const flowId = newFlowId();
  const runner = options.flowRunner ?? startGoalFitVirtualPaymentFlow as FlowRunner;
  const dependencies: Partial<GoalFitVirtualPaymentFlowDependencies<TReport>> = {
    isFlowActive: () => activeFor(flowId, options.assessmentId),
    onStateChange: (status) => {
      if (activeFor(flowId, options.assessmentId)) emit({ status, assessmentId: options.assessmentId, busy: true, canRetry: false });
    },
  };
  const holder = { flowId, assessmentId: options.assessmentId, invalidated: false, promise: Promise.resolve({ status: "failed", assessmentId: options.assessmentId } as GoalFitVirtualPaymentFlowResult) };
  active = holder;
  emit({ status: "preparing", assessmentId: options.assessmentId, busy: true, canRetry: false });
  holder.promise = runner<TReport>({ assessmentId: options.assessmentId, dependencies }).then((value) => {
    if (!activeFor(flowId, options.assessmentId)) return { status: "failed", assessmentId: options.assessmentId, safeCode: "PAYMENT_FLOW_STALE" } as GoalFitVirtualPaymentFlowResult<TReport>;
    active = null;
    emit(safeState(value));
    return value;
  }, () => {
    if (!activeFor(flowId, options.assessmentId)) return { status: "failed", assessmentId: options.assessmentId, safeCode: "PAYMENT_FLOW_STALE" } as GoalFitVirtualPaymentFlowResult<TReport>;
    active = null;
    const value = { status: "failed", assessmentId: options.assessmentId, safeCode: "PAYMENT_FAILED" } as GoalFitVirtualPaymentFlowResult<TReport>;
    emit(safeState(value));
    return value;
  });
  return holder.promise as Promise<GoalFitVirtualPaymentFlowResult<TReport>>;
}
