<script setup lang="ts">
import { onLoad, onShow, onUnload } from "@dcloudio/uni-app";
import { computed, ref, watch } from "vue";
import { fetchGoalFitFreeResult, fetchGoalFitFullReport, fetchLatestGoalFitPurchase, GoalFitReportAccessError, type GoalFitFullReportResponse } from "@/api/goal-fit-payment";
import { getPlatform } from "@/platform";
import { isWechatVirtualPaymentSupported, setWechatVirtualPaymentDiagnosticReporter } from "@/services/wechat-virtual-payment";
import { getDisplayFreeResult, readCompletedSession, saveCompletedSession, type GoalFitCompletedSessionV1, type GoalFitReportAccessState, type OfficialFreeResult } from "@/storage/goal-fit-session";
import { retryPendingAssessmentSync } from "@/services/assessment-sync";
import { getActiveGoalFitVirtualPaymentState, invalidateGoalFitVirtualPaymentFlow, resumeManagedGoalFitVirtualPaymentConfirmation, startManagedGoalFitVirtualPayment, subscribeGoalFitVirtualPaymentState, type GoalFitVirtualPaymentState } from "@/services/goal-fit-virtual-payment-controller";
import { hasReportConversion, type GoalFitReportConversion, type GoalFitReportValueProof, type GoalFitSelectedRiskPreview } from "@/types/goal-fit-report-conversion";
import { trackEvent } from "@/analytics";
import { clearGoalFitHistoryReportRecovery, readGoalFitHistoryReportRecovery, saveGoalFitHistoryReportRecovery } from "@/storage/goal-fit-history-report";

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
const expanded = ref(0);
const activePaidView = ref<"overview" | "full">("full");
const historyMode = ref(false);
const historyEntitlementUncertain = ref(false);
let session: GoalFitCompletedSessionV1 | null = null;
let active = true;
let unsub: (() => void) | undefined;
let autoRetries = 0;
let loadVersion = 0;
let lastCanPay = false;

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
const canPay = computed(() => showConversionArea.value && isWechatMiniapp.value && virtualPaymentSupported.value && hasStablePaymentContext.value && !payment.value.busy);
const paymentCapabilityUnavailable = computed(() => showConversionArea.value && isWechatMiniapp.value && !virtualPaymentSupported.value);
const paymentFailureNotice = computed(() => payment.value.safeCode === "PAYMENT_INVOKE_TIMEOUT" ? "未能调起支付，请重试" : "");

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function suffix(value: string | undefined): string | undefined { return value?.slice(-6); }
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
  expanded.value = expanded.value === index ? -1 : index;
}

function switchPaidView(view: "overview" | "full"): void {
  activePaidView.value = view;
  uni.pageScrollTo({ scrollTop: 0, duration: 0 });
}

watch([assessmentId, conversion], () => {
  expanded.value = 0;
  activePaidView.value = "full";
});
watch(canPay, (value) => {
  if (value && !lastCanPay) diagnostic("payment_button_enabled", { source: "free_result", contextMatch: true });
  lastCanPay = value;
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
  access.value = "REFUNDED";
  historyEntitlementUncertain.value = false;
  clearGoalFitHistoryReportRecovery(requestedId);
  save();
}

function setUnlocked(value: GoalFitFullReportResponse): void {
  if (!active || value.assessmentId !== assessmentId.value) return;
  report.value = value;
  access.value = hasReportConversion(value.fullReport) ? "UNLOCKED_V2" : "UNLOCKED_LEGACY";
  historyEntitlementUncertain.value = false;
  if (historyMode.value) clearGoalFitHistoryReportRecovery(value.assessmentId);
  save();
  void trackEvent("goal_fit_report_fetch_success", { metadata: { reportFormat: access.value, riskModuleCount: conversion.value?.selectedRiskModules.length ?? 0 } });
}

async function readReport(recovery = false): Promise<void> {
  if (!assessmentId.value) return;
  const requestedId = assessmentId.value;
  access.value = "ENTITLED_LOADING";
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
    access.value = "ENTITLED_TEMPORARY_UNAVAILABLE";
    if (historyMode.value) saveGoalFitHistoryReportRecovery({ assessmentId: requestedId, recoveryPending: true });
    save();
    void trackEvent("goal_fit_report_fetch_temporary_unavailable", { metadata: { recovery, temporary } });
  }
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
  access.value = session?.reportAccessState ?? "LOCKED";
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
  try {
    const latest = await fetchLatestGoalFitPurchase();
    if (!active || requestVersion !== loadVersion || assessmentId.value !== authoritativeId) return;
    purchaseStateLoaded.value = true;
    if (latest.purchase && latest.purchase.assessmentId === authoritativeId) {
      if (latest.purchase.status === "REFUNDED") setRefunded(authoritativeId);
      else setUnlocked(latest.purchase);
    }
  } catch { purchaseStateLoaded.value = true; }
  if (!active || requestVersion !== loadVersion) return;
  if (session?.reportRecoveryPending || (access.value !== "LOCKED" && access.value !== "REFUNDED") || session?.fullReport) await readReport(true);
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
  access.value = "ENTITLED_LOADING";
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
  await readReport(true);
  if (active && requestVersion === loadVersion && result.value) pageState.value = "ready";
  void trackEvent("goal_fit_report_detail_view", { metadata: { recovery: true } });
}

async function unlock(): Promise<void> {
  if (!canPay.value || payment.value.busy) return;
  void trackEvent("goal_fit_report_unlock_click", { metadata: { reportType: proof.value?.reportType, mappingVersion: proof.value?.mappingVersion, riskModuleCount: proof.value?.selectedRiskModules.length } });
  void trackEvent("payment_flow_entered", { metadata: { assessmentIdSuffix: suffix(assessmentId.value), reportSnapshotIdSuffix: suffix(session?.reportSnapshotId), pageState: pageState.value, purchaseStateLoaded: purchaseStateLoaded.value, contextMatch: hasStablePaymentContext.value } });
  access.value = "PREPARING_PAYMENT";
  const outcome = await startManagedGoalFitVirtualPayment({ assessmentId: assessmentId.value });
  if (outcome.status === "paid") {
    access.value = "ENTITLED_LOADING";
    save();
    void trackEvent("goal_fit_payment_confirmed", { metadata: { reportType: proof.value?.reportType } });
    if (outcome.report) setUnlocked(outcome.report as GoalFitFullReportResponse);
    else await readReport();
  } else if (outcome.status === "cancelled" || outcome.status === "closed") access.value = "PAYMENT_CANCELLED";
  else if (outcome.status === "pending") access.value = "CONFIRMING_PAYMENT";
  else access.value = "PAYMENT_FAILED";
  save();
}

async function resume(): Promise<void> {
  if (!assessmentId.value || getPlatform() !== "wechat_miniapp") return;
  const outcome = await resumeManagedGoalFitVirtualPaymentConfirmation({ assessmentId: assessmentId.value });
  if (outcome === null && !historyMode.value && !report.value && ["PREPARING_PAYMENT", "INVOKING_PAYMENT", "CONFIRMING_PAYMENT"].includes(access.value)) {
    access.value = "LOCKED";
    save();
    return;
  }
  if (outcome?.status === "paid") {
    access.value = "ENTITLED_LOADING";
    save();
    if (outcome.report) setUnlocked(outcome.report as GoalFitFullReportResponse);
    else await readReport(true);
  }
}

function state(value: GoalFitVirtualPaymentState): void {
  if (!active || (value.assessmentId && value.assessmentId !== assessmentId.value)) return;
  payment.value = value;
  if (value.status === "preparing") access.value = "PREPARING_PAYMENT";
  if (value.status === "invoking") access.value = "INVOKING_PAYMENT";
  if (value.status === "confirming") access.value = "CONFIRMING_PAYMENT";
}

onLoad((query) => {
  setWechatVirtualPaymentDiagnosticReporter((event, options) => trackEvent(event, options));
  unsub = subscribeGoalFitVirtualPaymentState(state);
  const requestedAssessmentId = typeof query?.assessmentId === "string" && /^asm_[A-Za-z0-9_-]{8,}$/.test(query.assessmentId) ? query.assessmentId : "";
  const requestedSessionId = typeof query?.sessionId === "string" ? query.sessionId : "";
  const historyRequested = query?.source === "my-reports";
  const recovery = !requestedAssessmentId && !requestedSessionId ? readGoalFitHistoryReportRecovery() : null;
  diagnostic("free_result_page_mounted", { source: historyRequested ? "history_route" : requestedSessionId ? "route_session" : "route_assessment", contextMatch: true });
  if (historyRequested && requestedAssessmentId) void loadHistory(requestedAssessmentId);
  else if (recovery) void loadHistory(recovery.assessmentId);
  else void load(requestedSessionId, requestedAssessmentId).then(resume);
});
onShow(() => {
  if (historyMode.value) {
    if (access.value === "ENTITLED_TEMPORARY_UNAVAILABLE" && autoRetries++ < 1) void readReport(true);
    return;
  }
  if (access.value === "ENTITLED_TEMPORARY_UNAVAILABLE" && autoRetries++ < 1) void readReport(true);
  else void resume();
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
        <text class="section-title">你的专属报告已经生成</text>
        <text class="section-copy">围绕本次测评中的3个重点问题，查看入职准备、行动提醒和面试确认问题。</text>
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

      <view v-if="access === 'REFUNDED'" class="refund-card card">
        <text class="section-title">该报告已退款</text>
        <text class="section-copy">完整报告查看权限已关闭。你的测评结果概览仍然保留，也可以重新解锁这份专属报告。</text>
      </view>

      <view v-if="access === 'ENTITLED_TEMPORARY_UNAVAILABLE'" class="recovery-card card">
        <text class="section-title">{{ historyEntitlementUncertain ? '报告权益状态暂时无法确认' : '报告正在同步' }}</text>
        <text class="section-copy">{{ historyEntitlementUncertain ? '请重新加载报告，你不需要再次付款。' : '你不需要再次付款，稍后可继续查看本次报告。' }}</text>
        <button class="retry-button" @click="readReport(true)">重新加载报告</button>
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
            <view class="section-toggle-content"><text class="section-title">{{ item.title }}</text><text v-if="hasText(item.coreExplanation)" class="section-copy">{{ item.coreExplanation }}</text><text class="section-action">{{ expanded === index ? '收起详细分析 ↑' : '查看详细分析 ↓' }}</text></view>
          </view>

          <view v-if="expanded === index" class="section-detail">
            <view v-if="item.scenarios.length" class="detail-group"><text class="detail-group-title">典型工作场景</text><view v-for="(scenario, scenarioIndex) in item.scenarios" :key="`${scenario.situation}-${scenarioIndex}`" class="scenario-card"><text class="scenario-index">场景0{{ scenarioIndex + 1 }}</text><text class="scenario-label">情境</text><text class="detail-copy">{{ scenario.situation }}</text><text class="scenario-label">反应</text><text class="detail-copy">{{ scenario.reaction }}</text></view></view>
            <view v-if="hasText(item.normalNewcomerReaction)" class="detail-group"><text class="detail-group-title">新人可能出现的正常反应</text><text class="detail-copy">{{ item.normalNewcomerReaction }}</text></view>
            <view v-if="hasText(item.sustainedRisk)" class="detail-group"><text class="detail-group-title">这种情况持续后的风险</text><text class="detail-copy">{{ item.sustainedRisk }}</text></view>
            <view v-if="hasItems(item.trainableParts)" class="detail-group"><text class="detail-group-title">可以训练的部分</text><view v-for="(entry, entryIndex) in item.trainableParts" :key="`${entry}-${entryIndex}`" class="detail-list-item"><text class="detail-list-index">{{ entryIndex + 1 }}</text><text class="detail-copy">{{ entry }}</text></view></view>
            <view v-if="hasItems(item.firstSevenDays)" class="detail-group"><text class="detail-group-title">入职前7天准备</text><view v-for="(entry, entryIndex) in item.firstSevenDays" :key="`${entry}-${entryIndex}`" class="detail-list-item"><text class="detail-list-index">{{ entryIndex + 1 }}</text><text class="detail-copy">{{ entry }}</text></view></view>
            <view v-if="hasItems(item.firstMonthReminder)" class="detail-group"><text class="detail-group-title">第一个月行动提醒</text><view v-for="(entry, entryIndex) in item.firstMonthReminder" :key="`${entry}-${entryIndex}`" class="detail-list-item"><text class="detail-list-index">{{ entryIndex + 1 }}</text><text class="detail-copy">{{ entry }}</text></view></view>
            <view v-if="hasItems(item.interviewQuestions)" class="detail-group"><text class="detail-group-title">面试确认问题</text><view v-for="(entry, entryIndex) in item.interviewQuestions" :key="`${entry}-${entryIndex}`" class="detail-list-item"><text class="detail-list-index">{{ entryIndex + 1 }}</text><text class="detail-copy">{{ entry }}</text></view></view>
          </view>
        </view>
      </view>
      <view v-else-if="report && !conversion" class="full-report card"><text class="section-title">完整报告已解锁</text><text class="section-copy">该报告使用兼容展示格式。</text></view>

      <view class="page-actions"><text class="home-link" @click="home">返回首页</text></view>
    </view>
    <view v-if="showConversionArea" class="fixed-cta"><view class="cta-inner"><text class="fixed-value-copy">{{ valueCounts[0].value }}个场景 · {{ valueCounts[1].value }}项训练 · {{ valueCounts[2].value }}个面试问题</text><button v-if="canPay" class="unlock-button" @click="unlock">{{ isRefunded ? '¥19.9 重新解锁专属报告' : '¥19.9 解锁你的专属报告' }}</button><button v-else class="unlock-button" disabled>¥19.9 解锁你的专属报告</button><text v-if="!purchaseStateLoaded" class="cta-copy">正在确认购买状态</text><text v-else-if="paymentCapabilityUnavailable" class="platform-copy">当前微信版本暂不支持虚拟支付，请升级微信后重试</text><text v-else-if="paymentFailureNotice" class="platform-copy">{{ paymentFailureNotice }}</text><text v-else-if="!canPay && isWechatMiniapp && virtualPaymentSupported" class="cta-copy">报告生成中</text><text v-else-if="!canPay" class="platform-copy">请在支持虚拟支付的微信客户端中完成支付</text><text v-else class="cta-copy">一次购买，长期查看本次报告</text></view></view>
  </view>
</template>

<style scoped>
.page{min-height:100vh;background:#f4f6fa;padding:28rpx 28rpx calc(48rpx + env(safe-area-inset-bottom));box-sizing:border-box}.content{padding-bottom:176rpx}.card{background:#fff;border-radius:24rpx;padding:30rpx;box-sizing:border-box;box-shadow:0 10rpx 28rpx rgba(43,55,88,.06)}.conclusion-card{border:1rpx solid #e4e8ff}.eyebrow{display:block;color:#5267d8;font-size:25rpx;font-weight:600;letter-spacing:1rpx}.conclusion-title{display:block;margin-top:18rpx;color:#1f2740;font-size:46rpx;line-height:1.28;font-weight:700}.conclusion-summary,.section-copy,.risk-copy,.preview-copy,.decision-copy{display:block;margin-top:14rpx;color:#667086;font-size:28rpx;line-height:1.65}.tag-row{display:flex;flex-wrap:wrap;gap:12rpx;margin-top:24rpx}.tag,.report-type{padding:8rpx 16rpx;border-radius:999rpx;font-size:24rpx}.tag{background:#f1f3f8;color:#566074}.report-type{background:#edf0ff;color:#4057d6}.section-heading{margin:38rpx 4rpx 20rpx}.section-title{display:block;color:#222b42;font-size:32rpx;font-weight:700;line-height:1.45}.risk-list{display:flex;flex-direction:column;gap:18rpx}.risk-card{position:relative;padding-left:94rpx}.risk-index{position:absolute;left:30rpx;top:34rpx;color:#7585df;font-size:30rpx;font-weight:700}.risk-title{display:block;color:#27314b;font-size:31rpx;font-weight:700}.value-card,.preview-card,.recovery-card,.full-report,.platform-card{margin-top:24rpx}.value-grid{display:flex;gap:14rpx;margin-top:24rpx}.value-item{flex:1;min-width:0;padding:22rpx 10rpx;background:#f5f7ff;border-radius:16rpx;text-align:center}.value-number{display:block;color:#4057d6;font-size:44rpx;font-weight:700;line-height:1}.value-label{display:block;margin-top:12rpx;color:#5f6880;font-size:23rpx;line-height:1.4}.locked-list{margin-top:22rpx}.locked-item{display:flex;align-items:center;gap:12rpx;margin-top:12rpx;padding:18rpx;border-radius:14rpx;background:#f7f8fb;color:#485269;font-size:27rpx}.lock{font-size:25rpx}.locked-note{margin-left:auto;color:#949bac;font-size:23rpx}.decision-copy{padding-top:18rpx;border-top:1rpx solid #edf0f6}.retry-button{margin-top:22rpx;background:#4057d6;color:#fff}.full-module{padding:22rpx 0;border-top:1rpx solid #edf0f6}.report-meta{display:block;margin:14rpx 0 22rpx;color:#667086;font-size:27rpx}.platform-card{border:1rpx solid #e4e8ff}.page-actions{text-align:center;padding:32rpx 0 14rpx}.home-link{color:#7b8497;font-size:27rpx}.fixed-cta{position:fixed;right:0;bottom:0;left:0;z-index:10;padding:18rpx 28rpx calc(18rpx + env(safe-area-inset-bottom));background:linear-gradient(180deg,rgba(244,246,250,0),#f4f6fa 28%)}.cta-inner{padding:16rpx;background:#fff;border-radius:22rpx;box-shadow:0 -6rpx 24rpx rgba(43,55,88,.12)}.unlock-button{background:#4057d6;color:#fff;font-size:31rpx;font-weight:700}.unlock-button[disabled]{opacity:.72}.cta-copy{display:block;margin-top:10rpx;color:#6f788d;font-size:24rpx;text-align:center}.empty-card{margin-top:80rpx}.full-report .risk-title{margin-top:20rpx}@media (max-width:360px){.page{padding-right:22rpx;padding-left:22rpx}.conclusion-title{font-size:42rpx}.value-label{font-size:21rpx}.risk-card{padding-left:82rpx}.risk-index{left:25rpx}}
.overall-score{display:block;margin-top:22rpx;padding:24rpx 26rpx;background:#f2f4ff;border:1rpx solid #e1e6ff;border-radius:18rpx}.overall-score-label{display:block;color:#667086;font-size:26rpx;line-height:1.4}.overall-score-value{display:block;margin-top:10rpx;color:#4057d6;font-size:82rpx;font-weight:700;line-height:1;letter-spacing:-2rpx}.overall-score-unit{margin-left:8rpx;color:#667086;font-size:30rpx;font-weight:600;letter-spacing:0}
.inline-purchase{margin-top:24rpx;border:1rpx solid #e1e6ff}.inline-unlock-button{margin-top:22rpx;background:#4057d6;color:#fff;font-size:30rpx;font-weight:700}.inline-unlock-button[disabled]{opacity:.72}.inline-purchase-copy,.platform-copy{display:block;margin-top:12rpx;color:#6f788d;font-size:24rpx;text-align:center}.platform-copy{color:#7b8497}
.purchase-value-grid{display:flex;gap:12rpx;margin-top:22rpx}.purchase-value-item{flex:1;min-width:0;padding:16rpx 8rpx;background:#f5f7ff;border-radius:14rpx;text-align:center}.purchase-value-number{display:block;color:#4057d6;font-size:34rpx;font-weight:700}.purchase-value-label{display:block;margin-top:8rpx;color:#5f6880;font-size:21rpx;line-height:1.35}.purchase-price{display:flex;align-items:baseline;justify-content:space-between;margin-top:22rpx;padding-top:18rpx;border-top:1rpx solid #edf0f6}.purchase-price-label{color:#667086;font-size:26rpx}.purchase-price-value{color:#4057d6;font-size:40rpx;font-weight:700}.inline-platform-button{margin-top:22rpx;background:#eef1f7;color:#657089;font-size:29rpx;font-weight:600}.inline-platform-button[disabled]{opacity:1}.fixed-value-copy{display:block;margin-bottom:12rpx;color:#5f6880;font-size:24rpx;text-align:center}
.full-report{margin-top:24rpx}.report-overview{display:flex;flex-direction:column;gap:18rpx;margin-top:18rpx}.overview-card{padding:28rpx 30rpx;border-radius:22rpx}.strength-card{background:#f1f4ff;border:1rpx solid #e1e6ff}.risk-overview-card{background:#f8f5f2;border:1rpx solid #eee4dc}.overview-label{display:block;color:#303b58;font-size:26rpx;font-weight:700}.overview-copy{display:block;margin-top:12rpx;color:#4f5a70;font-size:29rpx;line-height:1.65;word-break:break-word}.report-section-card{margin-top:20rpx;padding:0;overflow:hidden}.section-toggle{display:flex;gap:20rpx;padding:28rpx 28rpx 24rpx}.section-toggle-content{flex:1;min-width:0}.section-action{display:block;margin-top:18rpx;color:#4057d6;font-size:25rpx;font-weight:600}.section-detail{padding:0 28rpx 30rpx;border-top:1rpx solid #edf0f6}.detail-group{padding-top:26rpx}.detail-group-title{display:block;color:#303b58;font-size:28rpx;font-weight:700}.detail-copy{display:block;margin-top:12rpx;color:#5f6880;font-size:27rpx;line-height:1.65;word-break:break-word}.scenario-card{margin-top:16rpx;padding:20rpx;border-radius:16rpx;background:#f7f8fb}.scenario-index,.scenario-label{display:block;color:#6574c8;font-size:23rpx;font-weight:600}.scenario-label{margin-top:16rpx;color:#687286}.detail-list-item{display:flex;gap:14rpx;margin-top:14rpx;padding:16rpx;border-radius:14rpx;background:#f7f8fb}.detail-list-item .detail-copy{flex:1;min-width:0;margin-top:0}.detail-list-index{flex:0 0 34rpx;width:34rpx;height:34rpx;border-radius:50%;background:#e9edff;color:#4057d6;font-size:22rpx;line-height:34rpx;text-align:center}
.paid-view-switch{display:flex;gap:10rpx;margin-bottom:20rpx;padding:10rpx;background:#edf0f6}.paid-view-button{flex:1;margin:0;padding:16rpx 12rpx;border:0;border-radius:14rpx;background:transparent;color:#687286;font-size:27rpx;font-weight:600;line-height:1.35}.paid-view-button.active{background:#fff;color:#4057d6;box-shadow:0 4rpx 12rpx rgba(43,55,88,.08)}
</style>
