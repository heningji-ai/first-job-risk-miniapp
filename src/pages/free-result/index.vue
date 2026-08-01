<script setup lang="ts">
import { onLoad, onShow, onUnload } from "@dcloudio/uni-app";
import { computed, ref, watch } from "vue";
import { fetchGoalFitFreeResult, fetchGoalFitFullReport, fetchGoalFitPurchases, GoalFitReportAccessError, type GoalFitFullReportResponse } from "@/api/goal-fit-payment";
import { getPlatform } from "@/platform";
import { isWechatVirtualPaymentSupported, setWechatVirtualPaymentDiagnosticReporter } from "@/services/wechat-virtual-payment";
import { getDisplayFreeResult, readCompletedSession, saveCompletedSession, type GoalFitCompletedSessionV1, type GoalFitReportAccessState, type OfficialFreeResult } from "@/storage/goal-fit-session";
import { retryPendingAssessmentSync } from "@/services/assessment-sync";
import { getActiveGoalFitVirtualPaymentState, invalidateGoalFitVirtualPaymentFlow, resumeManagedGoalFitVirtualPaymentConfirmation, startManagedGoalFitVirtualPayment, subscribeGoalFitVirtualPaymentState, type GoalFitVirtualPaymentState } from "@/services/goal-fit-virtual-payment-controller";
import { hasReportConversion, type GoalFitReportConversion, type GoalFitReportValueProof, type GoalFitSelectedRiskPreview } from "@/types/goal-fit-report-conversion";
import { trackEvent } from "@/analytics";
import { clearGoalFitHistoryReportRecovery, readGoalFitHistoryReportRecovery, saveGoalFitHistoryReportRecovery } from "@/storage/goal-fit-history-report";
import { getPendingGoalFitPaymentConfirmation } from "@/storage/goal-fit-pending-payment";
import { goalFitPrivateEntryConfig } from "@/config/goal-fit-private-entry";
import { miniappBuildFingerprint } from "@/config/build-fingerprint";

const result = ref<OfficialFreeResult | null>(null);
const proof = ref<GoalFitReportValueProof | null>(null);
const report = ref<GoalFitFullReportResponse | null>(null);
const assessmentId = ref("");
const error = ref("");
const pageState = ref<"idle" | "loading" | "ready" | "error">("idle");
const purchaseStateLoaded = ref(false);
const resultAssessmentId = ref("");
const proofAssessmentId = ref("");
const snapshotAssessmentId = ref("");
const access = ref<GoalFitReportAccessState>("LOCKED");
const payment = ref<GoalFitVirtualPaymentState>(getActiveGoalFitVirtualPaymentState());
const expandedSections = ref<Set<number>>(new Set([0]));
const activePaidView = ref<"overview" | "full">("full");
const historyMode = ref(false);
const historyEntitlementUncertain = ref(false);
const serviceAccountQrOpen = ref(false);
let session: GoalFitCompletedSessionV1 | null = null;
let active = true;
let unsub: (() => void) | undefined;
let autoRetries = 0;
let loadVersion = 0;
let lastCanPay = false;
const serviceAccountExposed = new Set<"free_result" | "full_report">();
let reconcileGeneration = 0;
let reconcilePromise: Promise<void> | null = null;

const accessPriority: Record<GoalFitReportAccessState, number> = {
  LOCKED: 0, PREPARING_PAYMENT: 1, INVOKING_PAYMENT: 2, CONFIRMING_PAYMENT: 3,
  ENTITLED_LOADING: 4, ENTITLED_TEMPORARY_UNAVAILABLE: 5,
  UNLOCKED_V2: 6, UNLOCKED_LEGACY: 6, PAYMENT_CANCELLED: 0, PAYMENT_FAILED: 0, REFUNDED: 0,
};

function setAccess(next: GoalFitReportAccessState, options: { force?: boolean } = {}): boolean {
  if (!options.force && accessPriority[next] < accessPriority[access.value]) return false;
  access.value = next;
  updateNavigationTitle();
  return true;
}

const conversion = computed<GoalFitReportConversion | null>(() => report.value && hasReportConversion(report.value.fullReport) ? report.value.fullReport.reportConversion : null);
const displayOverallScore = computed<number | null>(() => {
  const score = result.value?.overallScore;
  return typeof score === "number" && Number.isFinite(score) && score >= 0 ? score : null;
});
const riskPreviews = computed<GoalFitSelectedRiskPreview[]>(() => proof.value?.selectedRiskPreviews.slice(0, 3) ?? []);
const valueCounts = computed(() => {
  const counts = proof.value?.counts;
  const safe = (value: unknown): number => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
  return [
    { value: safe(counts?.riskSceneCount), label: "真实工作场景" },
    { value: safe(counts?.trainableCount), label: "可提前训练项" },
    { value: safe(counts?.questionCount), label: "面试确认问题" },
  ];
});
const isWechatMiniapp = computed(() => getPlatform() === "wechat_miniapp");
const virtualPaymentSupported = computed(() => isWechatMiniapp.value && isWechatVirtualPaymentSupported());
const hasFreeResult = computed(() => !!result.value);
const isRetryableLockedState = computed(() => access.value === "LOCKED" || access.value === "PAYMENT_CANCELLED" || access.value === "PAYMENT_FAILED");
const isRefunded = computed(() => access.value === "REFUNDED");
const canPurchaseThisHistoryReport = computed(() => historyMode.value && isRefunded.value);
const showConversionArea = computed(() => pageState.value === "ready" && !report.value && hasFreeResult.value && (isRetryableLockedState.value || isRefunded.value) && (!historyMode.value || canPurchaseThisHistoryReport.value));
const hasStablePaymentContext = computed(() => /^asm_[A-Za-z0-9_-]{8,}$/.test(assessmentId.value) && resultAssessmentId.value === assessmentId.value && proofAssessmentId.value === assessmentId.value && snapshotAssessmentId.value === assessmentId.value && !!proof.value && purchaseStateLoaded.value);
type PaymentFlowBlockedReason = "PAGE_NOT_READY" | "CAN_PAY_FALSE" | "NOT_WECHAT_MINIPROGRAM" | "CAPABILITY_UNAVAILABLE" | "ASSESSMENT_ID_INVALID" | "RESULT_CONTEXT_MISMATCH" | "SNAPSHOT_MISSING" | "SNAPSHOT_CONTEXT_MISMATCH" | "PROOF_MISSING" | "PROOF_CONTEXT_MISMATCH" | "PURCHASES_NOT_LOADED" | "PURCHASE_NOT_ELIGIBLE" | "PAYMENT_ALREADY_IN_PROGRESS" | "HISTORY_MODE_BLOCKED" | "UNEXPECTED_HANDLER_ERROR";
function paymentFlowBlockedReason(): PaymentFlowBlockedReason | null {
  if (payment.value.busy) return "PAYMENT_ALREADY_IN_PROGRESS";
  if (pageState.value !== "ready") return "PAGE_NOT_READY";
  if (historyMode.value && !canPurchaseThisHistoryReport.value) return "HISTORY_MODE_BLOCKED";
  if (!isWechatMiniapp.value) return "NOT_WECHAT_MINIPROGRAM";
  if (!virtualPaymentSupported.value) return "CAPABILITY_UNAVAILABLE";
  if (!/^asm_[A-Za-z0-9_-]{8,}$/.test(assessmentId.value)) return "ASSESSMENT_ID_INVALID";
  if (!result.value || resultAssessmentId.value !== assessmentId.value) return "RESULT_CONTEXT_MISMATCH";
  if (!session?.reportSnapshotId) return "SNAPSHOT_MISSING";
  if (snapshotAssessmentId.value !== assessmentId.value) return "SNAPSHOT_CONTEXT_MISMATCH";
  if (!proof.value) return "PROOF_MISSING";
  if (proofAssessmentId.value !== assessmentId.value) return "PROOF_CONTEXT_MISMATCH";
  if (!purchaseStateLoaded.value) return "PURCHASES_NOT_LOADED";
  if (!showConversionArea.value) return "PURCHASE_NOT_ELIGIBLE";
  return null;
}
const canPay = computed(() => paymentFlowBlockedReason() === null);
const paymentCapabilityUnavailable = computed(() => showConversionArea.value && isWechatMiniapp.value && !virtualPaymentSupported.value);
const paymentFailureNotice = computed(() => payment.value.safeCode === "PAYMENT_INVOKE_TIMEOUT" ? "未能调起支付，请重试" : "");
const showPaymentReassurance = computed(() => ["CONFIRMING_PAYMENT", "ENTITLED_LOADING", "ENTITLED_TEMPORARY_UNAVAILABLE"].includes(access.value));
const serviceAccountEntryPageState = computed<"free_result" | "full_report" | null>(() => {
  if (pageState.value !== "ready" || showPaymentReassurance.value || !goalFitPrivateEntryConfig.serviceAccountQrPath) return null;
  if (access.value === "UNLOCKED_V2" && report.value) return "full_report";
  if (!report.value && result.value) return "free_result";
  return null;
});
const purchaseGuidance = computed(() => {
  const level = result.value?.overallConclusion?.level;
  if (level === "high_match" || level === "good_match") return "分数高，说明这个方向值得继续，但不代表你可以直接盲投。完整报告会帮你把现在的优势变成更有说服力的面试表达，也会提醒你入职后最容易忽略的风险点。";
  if (level === "high_risk" || level === "not_priority") return "如果你还准备继续投这个方向，就更不能只凭感觉继续投。完整报告会帮你看清：你最容易在哪些工作场景里吃亏，为什么会被质疑，以及面试和入职前要重点补哪些准备。";
  return "这个方向不是不能选，但你不能只看分数就开始投。完整报告会进一步告诉你：你会在哪些工作场景里承压、被挑战，哪些问题需要在面试里提前确认。";
});

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function suffix(value: string | undefined): string | undefined { return value?.slice(-6); }
function paymentFlowMetadata(reason?: PaymentFlowBlockedReason): Record<string, string | boolean | undefined> {
  return {
    reason,
    pageState: pageState.value,
    canPay: canPay.value,
    isWechatMiniProgram: isWechatMiniapp.value,
    virtualPaymentAvailable: virtualPaymentSupported.value,
    assessmentIdValid: /^asm_[A-Za-z0-9_-]{8,}$/.test(assessmentId.value),
    resultContextMatch: !!result.value && resultAssessmentId.value === assessmentId.value,
    snapshotPresent: !!session?.reportSnapshotId,
    snapshotContextMatch: snapshotAssessmentId.value === assessmentId.value,
    proofPresent: !!proof.value,
    proofContextMatch: proofAssessmentId.value === assessmentId.value,
    purchasesLoaded: purchaseStateLoaded.value,
    purchaseStatus: access.value,
    paymentInProgress: payment.value.busy,
    historyMode: historyMode.value,
    assessmentIdSuffix: suffix(assessmentId.value),
  };
}
function reportPaymentFlowBlocked(reason: PaymentFlowBlockedReason): void { void trackEvent("payment_flow_blocked", { metadata: paymentFlowMetadata(reason) }); }
function diagnostic(event: "free_result_page_mounted" | "free_result_fetch_started" | "free_result_fetch_succeeded" | "free_result_fetch_failed" | "free_result_ready" | "payment_button_enabled" | "assessment_context_mismatch", metadata: { source?: string; httpStatus?: number; retryCount?: number; elapsedMs?: number; errorMessageCategory?: string; contextMatch?: boolean } = {}): void {
  void trackEvent(event, { metadata: { assessmentIdSuffix: suffix(assessmentId.value), sessionIdSuffix: suffix(session?.id), reportSnapshotIdSuffix: suffix(session?.reportSnapshotId), source: metadata.source, httpStatus: metadata.httpStatus, retryCount: metadata.retryCount, elapsedMs: metadata.elapsedMs, pageState: pageState.value, purchaseStateLoaded: purchaseStateLoaded.value, contextMatch: metadata.contextMatch, errorMessageCategory: metadata.errorMessageCategory } });
}
function contextMismatch(source: string): void {
  diagnostic("assessment_context_mismatch", { source, contextMatch: false, errorMessageCategory: "ASSESSMENT_CONTEXT_MISMATCH" });
  pageState.value = "error";
  error.value = "当前结果与测评记录不一致，请重新加载";
}

function hasItems(value: unknown): value is string[] {
  return Array.isArray(value) && value.some((item) => hasText(item));
}

function toggleSection(index: number): void {
  const next = new Set(expandedSections.value);
  if (next.has(index)) next.delete(index);
  else next.add(index);
  expandedSections.value = next;
}

function isSectionExpanded(index: number): boolean {
  return expandedSections.value.has(index);
}

const reportSectionTitles = [
  "工作要求不清时，典型场景会是什么？",
  "哪些情况最容易让你感受到工作压力？",
  "哪些工作场景可能让你被挑战，甚至被否定？",
];

function reportSectionTitle(index: number, fallback: string): string {
  return reportSectionTitles[index] ?? fallback;
}

function displayFirstSevenDaysEntry(entry: string): string {
  const normalized = entry.replace(/\s/g, "");
  return normalized.includes(["拆解一份真实", "JD或者工作任务"].join(""))
    ? "主动向HR索要公司介绍、岗位资料或入职材料，也可以请HR帮你向用人部门确认，是否有业务资料可以提前学习和准备。"
    : entry;
}

function switchPaidView(view: "overview" | "full"): void {
  activePaidView.value = view;
  uni.pageScrollTo({ scrollTop: 0, duration: 0 });
}
function showServiceAccountQr(): void {
  const pageState = serviceAccountEntryPageState.value;
  if (!pageState || !goalFitPrivateEntryConfig.serviceAccountQrPath) return;
  void trackEvent("service_account_entry_clicked", { metadata: { pageState } });
  serviceAccountQrOpen.value = true;
}
function previewServiceAccountQr(): void {
  const pageState = serviceAccountEntryPageState.value;
  if (!pageState || !goalFitPrivateEntryConfig.serviceAccountQrPath) return;
  uni.previewImage({
    current: goalFitPrivateEntryConfig.serviceAccountQrPath,
    urls: [goalFitPrivateEntryConfig.serviceAccountQrPath],
    success: () => { void trackEvent("service_account_qr_previewed", { metadata: { pageState } }); },
  });
}


watch([assessmentId, conversion], () => {
  expandedSections.value = conversion.value?.sections.length ? new Set([0]) : new Set();
  activePaidView.value = "full";
});
watch(canPay, (value) => {
  if (value && !lastCanPay) diagnostic("payment_button_enabled", { source: "free_result", contextMatch: true });
  lastCanPay = value;
});
watch(serviceAccountEntryPageState, (pageState) => {
  if (pageState && !serviceAccountExposed.has(pageState)) {
    serviceAccountExposed.add(pageState);
    void trackEvent("service_account_entry_exposed", { metadata: { pageState } });
  }
});

function save(): void {
  if (!session) return;
  const next: GoalFitCompletedSessionV1 = {
    ...session,
    assessmentId: assessmentId.value,
    reportSnapshotId: report.value?.reportSnapshotId ?? session.reportSnapshotId,
    fullReport: report.value?.fullReport ?? session.fullReport,
    serverFreeResult: result.value ? { ...result.value, ...(proof.value ? { reportValueProof: proof.value } : {}) } : session.serverFreeResult,
    reportAccessState: access.value,
    reportRecoveryPending: access.value === "ENTITLED_TEMPORARY_UNAVAILABLE",
    syncStatus: "completed",
  };
  if (access.value === "REFUNDED") delete next.fullReport;
  session = next;
  saveCompletedSession(session);
}

function setRefunded(requestedId: string): void {
  if (!active || requestedId !== assessmentId.value) return;
  report.value = null;
  setAccess("REFUNDED", { force: true });
  historyEntitlementUncertain.value = false;
  clearGoalFitHistoryReportRecovery(requestedId);
  save();
}

function updateNavigationTitle(): void {
  uni.setNavigationBarTitle({ title: historyMode.value || access.value === "UNLOCKED_V2" || access.value === "UNLOCKED_LEGACY" ? "报告详情" : "免费结果" });
}

function setUnlocked(value: GoalFitFullReportResponse): void {
  if (!active || value.assessmentId !== assessmentId.value) return;
  report.value = value;
  setAccess(hasReportConversion(value.fullReport) ? "UNLOCKED_V2" : "UNLOCKED_LEGACY");
  updateNavigationTitle();
  historyEntitlementUncertain.value = false;
  if (historyMode.value) clearGoalFitHistoryReportRecovery(value.assessmentId);
  save();
  void trackEvent("goal_fit_report_fetch_success", { metadata: { reportFormat: access.value, riskModuleCount: conversion.value?.selectedRiskModules.length ?? 0 } });
}

async function readReport(recovery = false): Promise<void> {
  if (!assessmentId.value) return;
  const requestedId = assessmentId.value;
  setAccess("ENTITLED_LOADING");
  save();
  try {
    setUnlocked(await fetchGoalFitFullReport(requestedId));
    if (recovery) void trackEvent("goal_fit_report_recovery_success", { metadata: { recovery: true } });
  } catch (caught) {
    if (!active || assessmentId.value!==requestedId) return;
    if (caught instanceof GoalFitReportAccessError && caught.code === "FULL_REPORT_REFUNDED") {
      setRefunded(requestedId);
      return;
    }
    const temporary = caught instanceof GoalFitReportAccessError && caught.code === "FULL_REPORT_TEMPORARY_UNAVAILABLE";
    historyEntitlementUncertain.value = caught instanceof GoalFitReportAccessError && caught.code === "FULL_REPORT_NOT_ENTITLED" && historyMode.value;
    setAccess("ENTITLED_TEMPORARY_UNAVAILABLE");
    if (historyMode.value) saveGoalFitHistoryReportRecovery({ assessmentId: requestedId, recoveryPending: true });
    save();
    void trackEvent("goal_fit_report_fetch_temporary_unavailable", { metadata: { recovery, temporary } });
  }
}

/** Serializes every lifecycle and callback recovery attempt for the current assessment. */
async function reconcilePaymentAndEntitlement(reason: "initial" | "on_show" | "payment_callback" | "retry"): Promise<void> {
  if (!assessmentId.value || !active) return;
  if (reconcilePromise) return reconcilePromise;
  const generation = ++reconcileGeneration;
  const requestedId = assessmentId.value;
  const current = async (): Promise<void> => {
    const isCurrent = (): boolean => active && generation === reconcileGeneration && assessmentId.value === requestedId;
    const pending = getPendingGoalFitPaymentConfirmation({ assessmentId: requestedId });
    // A pending attempt has precedence; its confirmation flow owns report retrieval.
    if (pending || ["PREPARING_PAYMENT", "INVOKING_PAYMENT", "CONFIRMING_PAYMENT"].includes(access.value)) {
      setAccess("CONFIRMING_PAYMENT");
      const outcome = await resumeManagedGoalFitVirtualPaymentConfirmation({ assessmentId: requestedId });
      if (!isCurrent()) return;
      if (outcome?.status === "paid") {
        setAccess("ENTITLED_LOADING");
        if (outcome.report) setUnlocked(outcome.report as GoalFitFullReportResponse);
        else await readReport(true);
        return;
      }
      if (outcome?.status === "entitled_pending" || outcome?.status === "pending") {
        setAccess("ENTITLED_TEMPORARY_UNAVAILABLE"); save(); return;
      }
      if (outcome && ["cancelled", "closed", "failed"].includes(outcome.status)) {
        setAccess(outcome.status === "cancelled" || outcome.status === "closed" ? "PAYMENT_CANCELLED" : "PAYMENT_FAILED", { force: true }); save(); return;
      }
    }
    // Pending storage may be absent on iOS when lifecycle callbacks race. The server list is authoritative.
    try {
      setAccess("ENTITLED_LOADING");
      const purchases = await fetchGoalFitPurchases();
      if (!isCurrent()) return;
      purchaseStateLoaded.value = true;
      const purchase = purchases.purchases.find((item) => item.assessmentId === requestedId);
      if (purchase?.status === "ACTIVE" && purchase.unlocked) { await readReport(true); return; }
      if (purchase?.status === "REFUNDED") { setRefunded(requestedId); return; }
      if (access.value === "ENTITLED_LOADING") setAccess("LOCKED", { force: true });
      save();
    } catch {
      if (!isCurrent()) return;
      // Unknown server state is deliberately non-purchasable: avoid a duplicate charge.
      setAccess("ENTITLED_TEMPORARY_UNAVAILABLE");
      save();
      void trackEvent("goal_fit_payment_reconcile_unavailable", { metadata: { reason, assessmentIdSuffix: suffix(requestedId) } });
    }
  };
  reconcilePromise = current().finally(() => { if (generation === reconcileGeneration) reconcilePromise = null; });
  return reconcilePromise;
}

async function load(sessionId: string, routeAssessmentId: string): Promise<void> {
  const requestVersion = ++loadVersion;
  const startedAt = Date.now();
  pageState.value = "loading";
  error.value = "";
  purchaseStateLoaded.value = false;
  result.value = null;
  proof.value = null;
  report.value = null;
  resultAssessmentId.value = "";
  proofAssessmentId.value = "";
  snapshotAssessmentId.value = "";
  diagnostic("free_result_fetch_started", { source: sessionId ? "route_session" : "route_assessment", retryCount: autoRetries });
  session = sessionId ? readCompletedSession(sessionId) : routeAssessmentId ? readCompletedSession(routeAssessmentId) : null;
  if (!session && sessionId) {
    error.value = "未找到本次测评结果，请重新加载";
    pageState.value = "error";
    diagnostic("free_result_fetch_failed", { source: "route_session", elapsedMs: Date.now() - startedAt, errorMessageCategory: "SESSION_NOT_FOUND" });
    return;
  }
  if (session && routeAssessmentId && session.assessmentId && session.assessmentId !== routeAssessmentId) { contextMismatch("route_storage"); return; }
  if (session && !session.assessmentId) {
    const synced = await retryPendingAssessmentSync();
    if (!active || requestVersion !== loadVersion) return;
    session = sessionId ? readCompletedSession(sessionId) : synced;
  }
  const authoritativeId = routeAssessmentId || session?.assessmentId || "";
  if (!/^asm_[A-Za-z0-9_-]{8,}$/.test(authoritativeId)) {
    error.value = "结果仍在生成，请稍后重新加载";
    pageState.value = "error";
    diagnostic("free_result_fetch_failed", { source: "route", elapsedMs: Date.now() - startedAt, errorMessageCategory: "ASSESSMENT_ID_UNAVAILABLE" });
    return;
  }
  assessmentId.value = authoritativeId;
  setAccess(session?.reportAccessState ?? "LOCKED", { force: true });
  if (session?.assessmentId && session.assessmentId !== authoritativeId) { contextMismatch("session_assessment"); return; }
  result.value = session ? getDisplayFreeResult(session) : null;
  proof.value = session?.serverFreeResult?.reportValueProof ?? null;
  if (result.value) resultAssessmentId.value = authoritativeId;
  if (proof.value) proofAssessmentId.value = authoritativeId;
  if (session?.reportSnapshotId) snapshotAssessmentId.value = authoritativeId;
  try {
    const free = await fetchGoalFitFreeResult(authoritativeId);
    if (!active || requestVersion !== loadVersion || assessmentId.value !== authoritativeId || free.assessmentId !== authoritativeId) { if (active && free.assessmentId !== authoritativeId) contextMismatch("free_result_response"); return; }
    result.value = free.freeResult;
    proof.value = free.freeResult.reportValueProof ?? null;
    resultAssessmentId.value = authoritativeId;
    proofAssessmentId.value = proof.value ? authoritativeId : "";
    if (session && free.reportSnapshotId) { session = { ...session, reportSnapshotId: free.reportSnapshotId, serverFreeResult: free.freeResult, syncStatus: "completed" }; snapshotAssessmentId.value = authoritativeId; save(); }
    diagnostic("free_result_fetch_succeeded", { source: "api", elapsedMs: Date.now() - startedAt, contextMatch: true });
  } catch {
    if (!result.value || !proof.value) {
      error.value = "结果暂时无法加载";
      pageState.value = "error";
      diagnostic("free_result_fetch_failed", { source: "api", elapsedMs: Date.now() - startedAt, errorMessageCategory: "FREE_RESULT_FETCH_FAILED" });
      return;
    }
  }
  // This is deliberately assessment-scoped; latest purchase can belong to another report.
  await reconcilePaymentAndEntitlement("initial");
  if (!active || requestVersion !== loadVersion || assessmentId.value !== authoritativeId) return;
  if (!active || requestVersion !== loadVersion) return;
  if (session?.reportRecoveryPending || session?.fullReport) await reconcilePaymentAndEntitlement("initial");
  if (!active || requestVersion !== loadVersion) return;
  pageState.value = result.value ? "ready" : "error";
  if (pageState.value === "ready") {
    diagnostic("free_result_ready", { source: "api", elapsedMs: Date.now() - startedAt, contextMatch: true });
    if (proof.value) void trackEvent("goal_fit_report_value_proof_view", { metadata: { reportType: proof.value.reportType, mappingVersion: proof.value.mappingVersion, riskModuleCount: proof.value.selectedRiskModules.length } });
  }
}

async function loadHistory(id: string): Promise<void> {
  const requestVersion = ++loadVersion;
  pageState.value = "loading";
  purchaseStateLoaded.value = false;
  historyMode.value = true;
  historyEntitlementUncertain.value = false;
  session = null;
  assessmentId.value = id;
  report.value = null;
  result.value = null;
  proof.value = null;
  setAccess("ENTITLED_LOADING");
  saveGoalFitHistoryReportRecovery({ assessmentId: id, recoveryPending: false });
  try {
    const free = await fetchGoalFitFreeResult(id);
    if (!active || requestVersion !== loadVersion || assessmentId.value !== id || free.assessmentId !== id) { if (active && free.assessmentId !== id) contextMismatch("history_free_result"); return; }
    result.value = free.freeResult;
    proof.value = free.freeResult.reportValueProof ?? null;
    resultAssessmentId.value = id;
    proofAssessmentId.value = proof.value ? id : "";
    snapshotAssessmentId.value = free.reportSnapshotId ? id : "";
  } catch {
    if (!active || assessmentId.value !== id) return;
    error.value = "报告权益状态暂时无法确认，请重新加载。";
  }
  purchaseStateLoaded.value = true;
  await reconcilePaymentAndEntitlement("initial");
  if (active && requestVersion === loadVersion && result.value) pageState.value = "ready";
  void trackEvent("goal_fit_report_detail_view", { metadata: { recovery: true } });
}

async function unlock(): Promise<void> {
  try {
    void trackEvent("goal_fit_report_unlock_click", { metadata: { reportType: proof.value?.reportType, mappingVersion: proof.value?.mappingVersion, riskModuleCount: proof.value?.selectedRiskModules.length } });
    const blocked = paymentFlowBlockedReason();
    if (blocked) { reportPaymentFlowBlocked(blocked); return; }
    void trackEvent("payment_flow_entered", { metadata: paymentFlowMetadata() });
    setAccess("PREPARING_PAYMENT", { force: true });
    const outcome = await startManagedGoalFitVirtualPayment({ assessmentId: assessmentId.value });
    if (outcome.status === "paid") {
      setAccess("ENTITLED_LOADING");
      save();
      void trackEvent("goal_fit_payment_confirmed", { metadata: { reportType: proof.value?.reportType } });
      if (outcome.report) setUnlocked(outcome.report as GoalFitFullReportResponse);
      else await reconcilePaymentAndEntitlement("payment_callback");
    } else if (outcome.status === "cancelled" || outcome.status === "closed") setAccess("PAYMENT_CANCELLED", { force: true });
    else if (outcome.status === "pending") setAccess("CONFIRMING_PAYMENT");
    else if (outcome.status === "entitled_pending") {
      setAccess("ENTITLED_TEMPORARY_UNAVAILABLE");
      historyEntitlementUncertain.value = false;
    }
    else setAccess("PAYMENT_FAILED", { force: true });
    save();
  } catch {
    reportPaymentFlowBlocked("UNEXPECTED_HANDLER_ERROR");
    setAccess("PAYMENT_FAILED", { force: true });
    save();
  }
}

function state(value: GoalFitVirtualPaymentState): void {
  if (!active || (value.assessmentId && value.assessmentId !== assessmentId.value)) return;
  payment.value = value;
  if (value.status === "preparing") setAccess("PREPARING_PAYMENT");
  if (value.status === "invoking") setAccess("INVOKING_PAYMENT");
  if (value.status === "confirming") setAccess("CONFIRMING_PAYMENT");
  if (value.status === "entitled_loading") setAccess("ENTITLED_LOADING");
  if (value.status === "entitled_pending") setAccess("ENTITLED_TEMPORARY_UNAVAILABLE");
}

onLoad((query) => {
  setWechatVirtualPaymentDiagnosticReporter((event, options) => trackEvent(event, options));
  void trackEvent("miniapp_build_fingerprint", { metadata: miniappBuildFingerprint });
  unsub = subscribeGoalFitVirtualPaymentState(state);
  const requestedAssessmentId = typeof query?.assessmentId === "string" && /^asm_[A-Za-z0-9_-]{8,}$/.test(query.assessmentId) ? query.assessmentId : "";
  const requestedSessionId = typeof query?.sessionId === "string" ? query.sessionId : "";
  const historyRequested = query?.source === "my-reports";
  historyMode.value = historyRequested;
  updateNavigationTitle();
  const recovery = !requestedAssessmentId && !requestedSessionId ? readGoalFitHistoryReportRecovery() : null;
  diagnostic("free_result_page_mounted", { source: historyRequested ? "history_route" : requestedSessionId ? "route_session" : "route_assessment", contextMatch: true });
  if (historyRequested && requestedAssessmentId) void loadHistory(requestedAssessmentId);
  else if (recovery) void loadHistory(recovery.assessmentId);
  else void load(requestedSessionId, requestedAssessmentId);
});
onShow(() => {
  if (access.value === "ENTITLED_TEMPORARY_UNAVAILABLE" && autoRetries++ >= 1) return;
  void reconcilePaymentAndEntitlement("on_show");
});
onUnload(() => {
  active = false;
  setWechatVirtualPaymentDiagnosticReporter();
  unsub?.();
  if (assessmentId.value) invalidateGoalFitVirtualPaymentFlow({ assessmentId: assessmentId.value });
});
function home(): void { uni.reLaunch({ url: "/pages/index/index" }); }
function retryLoad(): void {
  if (historyMode.value && assessmentId.value) void loadHistory(assessmentId.value);
  else void load(session?.id ?? "", assessmentId.value);
}
function retryPaidReport(): void { void reconcilePaymentAndEntitlement("retry"); }
</script>

<template>
  <view class="page">
    <view v-if="pageState === 'loading'" class="empty-card card"><text class="conclusion-title">正在生成你的结果……</text><text class="section-copy">请稍候，正在确认本次测评结果与购买状态。</text></view>
    <view v-else-if="pageState === 'error'" class="empty-card card"><text class="conclusion-title">结果暂时无法加载</text><text class="section-copy">{{ error }}</text><button class="retry-button" @click="retryLoad">重新加载</button></view>
    <view v-else-if="pageState === 'ready'" class="content">
      <view v-if="conversion && result && proof" class="paid-view-switch card"><button :class="['paid-view-button', { active: activePaidView === 'overview' }]" @click="switchPaidView('overview')">结果概览</button><button :class="['paid-view-button', { active: activePaidView === 'full' }]" @click="switchPaidView('full')">完整报告</button></view>

      <view v-if="result && (!report || (conversion && activePaidView === 'overview'))" class="conclusion-card card">
        <text class="eyebrow">本次职场预演结论</text>
        <text class="conclusion-title">{{ result.overallConclusion.title }}</text>
        <view class="overall-score" aria-label="综合适配分">
          <text class="overall-score-label">综合适配分</text>
          <text class="overall-score-value">{{ displayOverallScore ?? "—" }}<text class="overall-score-unit">分</text></text>
        </view>
        <text class="conclusion-summary">{{ result.overallConclusion.summary }}</text>
        <view v-if="proof" class="tag-row">
          <text class="tag">{{ proof.companyType }}</text>
          <text class="tag">{{ proof.roleName }}</text>
          <text class="report-type">{{ proof.reportTypeTitle }}</text>
        </view>
      </view>

      <template v-if="proof && (!report || (conversion && activePaidView === 'overview'))">
        <view class="section-heading"><text class="section-title">你最需要提前看清的三个场景</text><text class="section-copy">它们来自你本次的公司、岗位与34题回答。</text></view>
        <view class="risk-list">
          <view v-for="(item, index) in riskPreviews" :key="item.moduleId" class="risk-card card">
            <text class="risk-index">0{{ index + 1 }}</text>
            <text class="risk-title">{{ item.title }}</text>
            <text class="risk-copy">{{ item.previewShort }}</text>
          </view>
        </view>

        <view class="value-card card">
          <text class="section-title">完整报告会帮你提前准备</text>
          <view class="value-grid">
            <view v-for="item in valueCounts" :key="item.label" class="value-item">
              <text class="value-number">{{ item.value }}</text>
              <text class="value-label">{{ item.label }}</text>
            </view>
          </view>
        </view>

        <view class="preview-card card">
          <text class="section-title">报告内容预览</text>
          <text v-if="riskPreviews[0]" class="preview-copy">{{ riskPreviews[0].previewShort }}</text>
          <view class="locked-list">
            <view v-for="label in ['入职前准备建议', '第一个月行动提醒', '面试确认问题']" :key="label" class="locked-item">
              <text class="lock">🔒</text><text>{{ label }}</text><text class="locked-note">解锁后查看</text>
            </view>
          </view>
          <text v-if="proof.decisionCopy" class="decision-copy">{{ proof.decisionCopy }}</text>
        </view>
      </template>

      <view v-if="showConversionArea" class="inline-purchase card">
        <text class="purchase-guidance">{{ purchaseGuidance }}</text>
        <text class="section-title">你的专属报告已经生成</text>
        <text class="section-copy">围绕本次测评中的3个重点问题，查看入职准备、行动提醒和面试确认问题。</text>
        <text class="purchase-value-title">完整报告会继续帮你看清：</text>
        <view class="purchase-value-grid">
          <view v-for="item in valueCounts" :key="item.label" class="purchase-value-item"><text class="purchase-value-number">{{ item.value }}</text><text class="purchase-value-label">{{ item.label }}</text></view>
        </view>
        <view class="purchase-price"><text class="purchase-price-label">本次解锁价格</text><text class="purchase-price-value">¥19.9</text></view>
        <button v-if="canPay" class="inline-unlock-button" :disabled="payment.busy" @click="unlock">{{ isRefunded ? '¥19.9 重新解锁专属报告' : '¥19.9 解锁你的专属报告' }}</button>
        <button v-else-if="paymentCapabilityUnavailable" class="inline-platform-button" disabled>当前微信版本暂不支持虚拟支付，请升级微信后重试</button>
        <button v-else-if="isWechatMiniapp && virtualPaymentSupported" class="inline-platform-button" disabled>正在准备你的专属报告</button>
        <button v-else class="inline-platform-button" disabled>¥19.9 解锁你的专属报告</button>
        <text v-if="!canPay && !paymentCapabilityUnavailable && !(isWechatMiniapp && virtualPaymentSupported)" class="platform-copy">请在支持虚拟支付的微信客户端中完成支付</text>
        <text v-if="paymentFailureNotice" class="platform-copy">{{ paymentFailureNotice }}</text>
        <text class="inline-purchase-copy">一次购买，长期查看本次报告</text>
      </view>
      <view v-if="serviceAccountEntryPageState === 'free_result'" class="service-account-entry service-account-entry-free" role="button" @click="showServiceAccountQr">
        <text>关注猎头季哥服务号，继续获得求职帮助</text><text class="service-account-entry-arrow">›</text>
      </view>

      <view v-if="access === 'REFUNDED'" class="refund-card card">
        <text class="section-title">该报告已退款</text>
        <text class="section-copy">完整报告查看权限已关闭。你的测评结果概览仍然保留，也可以重新解锁这份专属报告。</text>
      </view>

      <view v-if="conversion && (!result || !proof || activePaidView === 'full')" class="full-report">
        <view class="report-header card">
          <text class="eyebrow">完整报告已解锁</text>
          <text class="conclusion-title">{{ conversion.reportTypeTitle }}</text>
          <view class="tag-row"><text class="tag">{{ conversion.companyType }}</text><text class="tag">{{ conversion.roleName }}</text></view>
        </view>

        <view class="report-overview">
          <view class="overview-card strength-card"><text class="overview-label">你的优势</text><text class="overview-copy">{{ conversion.primaryStrength }}</text></view>
          <view class="overview-card risk-overview-card"><text class="overview-label">最需要关注的风险</text><text class="overview-copy">{{ conversion.primaryRisk }}</text></view>
        </view>

        <view v-for="(item, index) in conversion.sections" :key="item.moduleId" class="report-section-card card">
          <view class="section-toggle" role="button" @click="toggleSection(index)">
            <text class="risk-index">0{{ index + 1 }}</text>
            <view class="section-toggle-content"><text class="section-title">{{ reportSectionTitle(index, item.title) }}</text><text v-if="hasText(item.coreExplanation)" class="section-copy">{{ item.coreExplanation }}</text><text class="section-action">{{ isSectionExpanded(index) ? '收起详细分析 ↑' : '查看详细分析 ↓' }}</text></view>
          </view>

          <view v-if="isSectionExpanded(index)" class="section-detail">
            <view v-if="item.scenarios.length" class="detail-group"><text class="detail-group-title">典型工作场景</text><view v-for="(scenario, scenarioIndex) in item.scenarios" :key="`${scenario.situation}-${scenarioIndex}`" class="scenario-card"><text class="scenario-index">场景0{{ scenarioIndex + 1 }}</text><text class="scenario-label">情境</text><text class="detail-copy">{{ scenario.situation }}</text><text class="scenario-label">反应</text><text class="detail-copy">{{ scenario.reaction }}</text></view></view>
            <view v-if="hasText(item.normalNewcomerReaction)" class="detail-group"><text class="detail-group-title">新人可能出现的正常反应</text><text class="detail-copy">{{ item.normalNewcomerReaction }}</text></view>
            <view v-if="hasText(item.sustainedRisk)" class="detail-group"><text class="detail-group-title">这种情况持续后的风险</text><text class="detail-copy">{{ item.sustainedRisk }}</text></view>
            <view v-if="hasItems(item.trainableParts)" class="detail-group"><text class="detail-group-title">可以训练的部分</text><view v-for="(entry, entryIndex) in item.trainableParts" :key="`${entry}-${entryIndex}`" class="detail-list-item"><text class="detail-list-index">{{ entryIndex + 1 }}</text><text class="detail-copy">{{ entry }}</text></view></view>
            <view v-if="hasItems(item.firstSevenDays)" class="detail-group"><text class="detail-group-title">入职前7天准备</text><view v-for="(entry, entryIndex) in item.firstSevenDays" :key="`${entry}-${entryIndex}`" class="detail-list-item"><text class="detail-list-index">{{ entryIndex + 1 }}</text><text class="detail-copy">{{ displayFirstSevenDaysEntry(entry) }}</text></view></view>
            <view v-if="hasItems(item.firstMonthReminder)" class="detail-group"><text class="detail-group-title">如果你入职后面对这样的压力，第一个月应该注意什么？</text><view v-for="(entry, entryIndex) in item.firstMonthReminder" :key="`${entry}-${entryIndex}`" class="detail-list-item"><text class="detail-list-index">{{ entryIndex + 1 }}</text><text class="detail-copy">{{ entry }}</text></view></view>
            <view v-if="hasItems(item.interviewQuestions)" class="detail-group"><text class="detail-group-title">面试确认问题</text><text class="section-copy">如果你不希望入职后面对这样的压力，面试时需要确认：</text><view v-for="(entry, entryIndex) in item.interviewQuestions" :key="`${entry}-${entryIndex}`" class="detail-list-item"><text class="detail-list-index">{{ entryIndex + 1 }}</text><text class="detail-copy">{{ entry }}</text></view></view>
          </view>
        </view>
      </view>
      <view v-else-if="report && !conversion" class="full-report card"><text class="section-title">完整报告已解锁</text><text class="section-copy">该报告使用兼容展示格式。</text></view>

      <view class="page-actions"><text class="home-link" @click="home">返回首页</text></view>
    </view>
    <view v-if="showConversionArea" class="fixed-cta"><view class="cta-inner"><text class="fixed-value-copy">{{ valueCounts[0].value }}个场景 · {{ valueCounts[1].value }}项训练 · {{ valueCounts[2].value }}个面试问题</text><button v-if="canPay" class="unlock-button" @click="unlock">{{ isRefunded ? '¥19.9 重新解锁专属报告' : '¥19.9 解锁你的专属报告' }}</button><button v-else class="unlock-button" disabled>¥19.9 解锁你的专属报告</button><text v-if="!purchaseStateLoaded" class="cta-copy">正在确认购买状态</text><text v-else-if="paymentCapabilityUnavailable" class="platform-copy">当前微信版本暂不支持虚拟支付，请升级微信后重试</text><text v-else-if="paymentFailureNotice" class="platform-copy">{{ paymentFailureNotice }}</text><text v-else-if="!canPay && isWechatMiniapp && virtualPaymentSupported" class="cta-copy">报告生成中</text><text v-else-if="!canPay" class="platform-copy">请在支持虚拟支付的微信客户端中完成支付</text><text v-else class="cta-copy">一次购买，长期查看本次报告</text></view></view>
    <view v-if="showPaymentReassurance" class="payment-modal-mask"><view class="payment-modal card"><template v-if="access === 'CONFIRMING_PAYMENT'"><text class="section-title">正在确认付款结果</text><text class="section-copy">请稍候，不要重复支付。确认完成后将自动为你打开完整报告。</text></template><template v-else-if="access === 'ENTITLED_LOADING'"><text class="section-title">付款已完成</text><text class="section-copy">正在为你生成完整报告，通常只需要几秒钟。</text></template><template v-else><text class="section-title">付款已经完成，请放心，不会重复扣费</text><text class="section-copy">完整报告暂时未能加载，你可以稍后重新打开，或点击下方按钮继续加载。</text><button class="retry-button" @click="retryPaidReport">重新加载报告</button></template></view></view>
    <view v-if="serviceAccountEntryPageState === 'full_report'" class="service-account-entry service-account-entry-fixed" role="button" @click="showServiceAccountQr"><text>关注服务号</text><text class="service-account-entry-arrow">›</text></view>
    <view v-if="serviceAccountQrOpen" class="service-account-modal-mask" @click.self="serviceAccountQrOpen = false"><view class="service-account-modal card"><text class="section-title">继续获得求职帮助</text><text class="section-copy">关注猎头季哥服务号，获取求职、简历和面试方面的后续内容。需要进一步判断时，可以回复“预演报告”。</text><text class="section-copy">长按识别二维码关注</text><image class="service-account-qr" :src="goalFitPrivateEntryConfig.serviceAccountQrPath" mode="widthFix" @click="previewServiceAccountQr" /></view></view>
  </view>
</template>

<style scoped>
.page{min-height:100vh;background:#f4f6fa;padding:28rpx 28rpx calc(48rpx + env(safe-area-inset-bottom));box-sizing:border-box}.content{padding-bottom:176rpx}.card{background:#fff;border-radius:24rpx;padding:30rpx;box-sizing:border-box;box-shadow:0 10rpx 28rpx rgba(43,55,88,.06)}.conclusion-card{border:1rpx solid #e4e8ff}.eyebrow{display:block;color:#5267d8;font-size:25rpx;font-weight:600;letter-spacing:1rpx}.conclusion-title{display:block;margin-top:18rpx;color:#1f2740;font-size:46rpx;line-height:1.28;font-weight:700}.conclusion-summary,.section-copy,.risk-copy,.preview-copy,.decision-copy{display:block;margin-top:14rpx;color:#667086;font-size:28rpx;line-height:1.65}.tag-row{display:flex;flex-wrap:wrap;gap:12rpx;margin-top:24rpx}.tag,.report-type{padding:8rpx 16rpx;border-radius:999rpx;font-size:24rpx}.tag{background:#f1f3f8;color:#566074}.report-type{background:#edf0ff;color:#4057d6}.section-heading{margin:38rpx 4rpx 20rpx}.section-title{display:block;color:#222b42;font-size:32rpx;font-weight:700;line-height:1.45}.risk-list{display:flex;flex-direction:column;gap:18rpx}.risk-card{position:relative;padding-left:94rpx}.risk-index{position:absolute;left:30rpx;top:34rpx;color:#7585df;font-size:30rpx;font-weight:700}.risk-title{display:block;color:#27314b;font-size:31rpx;font-weight:700}.value-card,.preview-card,.recovery-card,.full-report,.platform-card{margin-top:24rpx}.value-grid{display:flex;gap:14rpx;margin-top:24rpx}.value-item{flex:1;min-width:0;padding:22rpx 10rpx;background:#f5f7ff;border-radius:16rpx;text-align:center}.value-number{display:block;color:#4057d6;font-size:44rpx;font-weight:700;line-height:1}.value-label{display:block;margin-top:12rpx;color:#5f6880;font-size:23rpx;line-height:1.4}.locked-list{margin-top:22rpx}.locked-item{display:flex;align-items:center;gap:12rpx;margin-top:12rpx;padding:18rpx;border-radius:14rpx;background:#f7f8fb;color:#485269;font-size:27rpx}.lock{font-size:25rpx}.locked-note{margin-left:auto;color:#949bac;font-size:23rpx}.decision-copy{padding-top:18rpx;border-top:1rpx solid #edf0f6}.retry-button{margin-top:22rpx;background:#4057d6;color:#fff}.full-module{padding:22rpx 0;border-top:1rpx solid #edf0f6}.report-meta{display:block;margin:14rpx 0 22rpx;color:#667086;font-size:27rpx}.platform-card{border:1rpx solid #e4e8ff}.page-actions{text-align:center;padding:32rpx 0 14rpx}.home-link{color:#7b8497;font-size:27rpx}.fixed-cta{position:fixed;right:0;bottom:0;left:0;z-index:10;padding:18rpx 28rpx calc(18rpx + env(safe-area-inset-bottom));background:linear-gradient(180deg,rgba(244,246,250,0),#f4f6fa 28%)}.cta-inner{padding:16rpx;background:#fff;border-radius:22rpx;box-shadow:0 -6rpx 24rpx rgba(43,55,88,.12)}.unlock-button{background:#4057d6;color:#fff;font-size:31rpx;font-weight:700}.unlock-button[disabled]{opacity:.72}.cta-copy{display:block;margin-top:10rpx;color:#6f788d;font-size:24rpx;text-align:center}.empty-card{margin-top:80rpx}.full-report .risk-title{margin-top:20rpx}@media (max-width:360px){.page{padding-right:22rpx;padding-left:22rpx}.conclusion-title{font-size:42rpx}.value-label{font-size:21rpx}.risk-card{padding-left:82rpx}.risk-index{left:25rpx}}
.overall-score{display:block;margin-top:22rpx;padding:24rpx 26rpx;background:#f2f4ff;border:1rpx solid #e1e6ff;border-radius:18rpx}.overall-score-label{display:block;color:#667086;font-size:26rpx;line-height:1.4}.overall-score-value{display:block;margin-top:10rpx;color:#4057d6;font-size:82rpx;font-weight:700;line-height:1;letter-spacing:-2rpx}.overall-score-unit{margin-left:8rpx;color:#667086;font-size:30rpx;font-weight:600;letter-spacing:0}
.inline-purchase{margin-top:24rpx;border:1rpx solid #e1e6ff}.inline-unlock-button{margin-top:22rpx;background:#4057d6;color:#fff;font-size:30rpx;font-weight:700}.inline-unlock-button[disabled]{opacity:.72}.inline-purchase-copy,.platform-copy{display:block;margin-top:12rpx;color:#6f788d;font-size:24rpx;text-align:center}.platform-copy{color:#7b8497}
.purchase-value-title{display:block;margin-top:20rpx;color:#4f5a70;font-size:25rpx;font-weight:600;line-height:1.45}.purchase-value-grid{display:flex;gap:12rpx;margin-top:14rpx}.purchase-value-item{flex:1;min-width:0;padding:16rpx 8rpx;background:#f5f7ff;border-radius:14rpx;text-align:center}.purchase-value-number{display:block;color:#4057d6;font-size:34rpx;font-weight:700}.purchase-value-label{display:block;margin-top:8rpx;color:#5f6880;font-size:21rpx;line-height:1.35}.purchase-price{display:flex;align-items:baseline;justify-content:space-between;margin-top:22rpx;padding-top:18rpx;border-top:1rpx solid #edf0f6}.purchase-price-label{color:#667086;font-size:26rpx}.purchase-price-value{color:#4057d6;font-size:40rpx;font-weight:700}.inline-platform-button{margin-top:22rpx;background:#eef1f7;color:#657089;font-size:29rpx;font-weight:600}.inline-platform-button[disabled]{opacity:1}.fixed-value-copy{display:block;margin-bottom:12rpx;color:#5f6880;font-size:24rpx;text-align:center}
.full-report{margin-top:24rpx}.report-overview{display:flex;flex-direction:column;gap:18rpx;margin-top:18rpx}.overview-card{padding:28rpx 30rpx;border-radius:22rpx}.strength-card{background:#f1f4ff;border:1rpx solid #e1e6ff}.risk-overview-card{background:#f8f5f2;border:1rpx solid #eee4dc}.overview-label{display:block;color:#303b58;font-size:26rpx;font-weight:700}.overview-copy{display:block;margin-top:12rpx;color:#4f5a70;font-size:29rpx;line-height:1.65;word-break:break-word}.report-section-card{margin-top:20rpx;padding:0;overflow:hidden}.section-toggle{display:flex;gap:20rpx;padding:28rpx 28rpx 24rpx}.section-toggle-content{flex:1;min-width:0}.section-action{display:block;margin-top:18rpx;color:#4057d6;font-size:25rpx;font-weight:600}.section-detail{padding:0 28rpx 30rpx;border-top:1rpx solid #edf0f6}.detail-group{padding-top:26rpx}.detail-group-title{display:block;color:#303b58;font-size:28rpx;font-weight:700}.detail-copy{display:block;margin-top:12rpx;color:#5f6880;font-size:27rpx;line-height:1.65;word-break:break-word}.scenario-card{margin-top:16rpx;padding:20rpx;border-radius:16rpx;background:#f7f8fb}.scenario-index,.scenario-label{display:block;color:#6574c8;font-size:23rpx;font-weight:600}.scenario-label{margin-top:16rpx;color:#687286}.detail-list-item{display:flex;gap:14rpx;margin-top:14rpx;padding:16rpx;border-radius:14rpx;background:#f7f8fb}.detail-list-item .detail-copy{flex:1;min-width:0;margin-top:0}.detail-list-index{flex:0 0 34rpx;width:34rpx;height:34rpx;border-radius:50%;background:#e9edff;color:#4057d6;font-size:22rpx;line-height:34rpx;text-align:center}
.paid-view-switch{display:flex;gap:10rpx;margin-bottom:20rpx;padding:10rpx;background:#edf0f6}.paid-view-button{flex:1;margin:0;padding:16rpx 12rpx;border:0;border-radius:14rpx;background:transparent;color:#687286;font-size:27rpx;font-weight:600;line-height:1.35}.paid-view-button.active{background:#fff;color:#4057d6;box-shadow:0 4rpx 12rpx rgba(43,55,88,.08)}
.payment-modal-mask{position:fixed;z-index:30;inset:0;display:flex;align-items:center;justify-content:center;padding:48rpx;background:rgba(20,28,45,.42)}.payment-modal{width:100%;max-width:620rpx}
.purchase-guidance{display:block;margin:0 0 18rpx;color:#4f5a70;font-size:27rpx;line-height:1.6}
.service-account-entry{display:flex;align-items:center;justify-content:center;gap:8rpx;color:#5267aa;font-size:25rpx;line-height:1.5;text-align:center}.service-account-entry-arrow{font-size:31rpx;font-weight:600;line-height:1}.service-account-entry-free{width:fit-content;max-width:100%;margin:20rpx auto 0;padding:14rpx 22rpx;border:1rpx solid #d7dff4;border-radius:999rpx;background:#f5f7ff;box-sizing:border-box}.service-account-entry-fixed{position:fixed;right:28rpx;bottom:calc(34rpx + env(safe-area-inset-bottom));z-index:12;padding:18rpx 26rpx;border:1rpx solid #d7dff4;border-radius:999rpx;background:#fff;box-shadow:0 8rpx 24rpx rgba(43,55,88,.16)}.service-account-modal-mask{position:fixed;z-index:40;inset:0;display:flex;align-items:center;justify-content:center;padding:48rpx;background:rgba(20,28,45,.42)}.service-account-modal{width:100%;max-width:650rpx}.service-account-qr{display:block;width:440rpx;max-width:100%;margin:24rpx auto 0;border-radius:14rpx}
</style>
