<script setup lang="ts">
import { onLoad, onShow, onUnload } from "@dcloudio/uni-app";
import { ref } from "vue";
import { fetchGoalFitFullReport, fetchLatestGoalFitPurchase, type GoalFitFullReportResponse } from "@/api/goal-fit-payment";
import type { GoalFitResult } from "@/domain/goal-fit/types";
import { getPlatform } from "@/platform";
import { getDisplayFreeResult, readCompletedSession, readLatestCompletedSession, saveCompletedSession, type GoalFitCompletedSessionV1, type OfficialFreeResult } from "@/storage/goal-fit-session";
import { recoverLatestAssessment, retryPendingAssessmentSync } from "@/services/assessment-sync";
import { getActiveGoalFitVirtualPaymentState, invalidateGoalFitVirtualPaymentFlow, resumeManagedGoalFitVirtualPaymentConfirmation, startManagedGoalFitVirtualPayment, subscribeGoalFitVirtualPaymentState, type GoalFitVirtualPaymentState } from "@/services/goal-fit-virtual-payment-controller";

const result = ref<OfficialFreeResult | null>(null);
const error = ref("");
const assessmentId = ref("");
const paymentState = ref<GoalFitVirtualPaymentState>(getActiveGoalFitVirtualPaymentState());
const paymentMessage = ref("");
const fullReport = ref<GoalFitResult | null>(null);
let active = true;
let currentSession: GoalFitCompletedSessionV1 | null = null;
let unsubscribe: (() => void) | undefined;

function reportAsFreeResult(report: GoalFitResult): OfficialFreeResult {
  return {
    overallScore: report.scores.overallScore,
    overallConclusion: report.overallConclusion,
    primaryRisk: report.riskInsights[0] ?? { title: "具体团队差异风险", description: "请结合实际团队、岗位边界和考核方式继续确认。" },
    riskInsights: report.riskInsights,
    recommendations: report.recommendations,
  };
}

function setPayment(state: GoalFitVirtualPaymentState): void {
  if (!active || (state.assessmentId && state.assessmentId !== assessmentId.value)) return;
  paymentState.value = state;
  paymentMessage.value = state.status === "pending" ? "支付结果正在确认，请稍后返回本页查看"
    : state.status === "cancelled" ? "支付已取消"
      : state.status === "closed" ? "本次支付未完成，可以重新尝试"
        : state.status === "review_required" ? "支付状态需要进一步确认，请稍后重新进入查看"
          : state.status === "unsupported" ? "当前微信版本暂不支持支付，请升级微信后重试"
            : state.status === "failed" ? "支付暂时未能完成，请稍后再试" : "";
}

function applyReport(response: GoalFitFullReportResponse): void {
  if (!active || response.assessmentId !== assessmentId.value) return;
  fullReport.value = response.fullReport;
  result.value = reportAsFreeResult(response.fullReport);
  paymentState.value = { status: "paid", assessmentId: response.assessmentId, busy: false, canRetry: false };
  paymentMessage.value = "完整报告已解锁";
  if (currentSession) {
    currentSession = { ...currentSession, assessmentId: response.assessmentId, reportSnapshotId: response.reportSnapshotId, fullReport: response.fullReport, syncStatus: "completed" };
    saveCompletedSession(currentSession);
  }
}

async function restoreFullReport(id: string): Promise<boolean> {
  if (!id || getPlatform() !== "wechat_miniapp") return false;
  try { applyReport(await fetchGoalFitFullReport(id)); return true; } catch { return false; }
}

async function load(id: string): Promise<void> {
  let session = id ? readCompletedSession(id) : readLatestCompletedSession();
  if (!session) session = await recoverLatestAssessment();
  else if (!session.assessmentId) { await retryPendingAssessmentSync(); session = id ? readCompletedSession(id) : readLatestCompletedSession(); }
  currentSession = session;
  const display = session ? getDisplayFreeResult(session) : null;
  assessmentId.value = session?.assessmentId?.startsWith("asm_") ? session.assessmentId : "";
  if (session?.fullReport && assessmentId.value) applyReport({ assessmentId: assessmentId.value, reportSnapshotId: session.reportSnapshotId ?? "", fullReport: session.fullReport });
  if (assessmentId.value && !fullReport.value) await restoreFullReport(assessmentId.value);
  if (!result.value && display) result.value = display;
  if (!result.value && getPlatform() === "wechat_miniapp") {
    try {
      const latest = await fetchLatestGoalFitPurchase();
      if (latest.purchase) {
        assessmentId.value = latest.purchase.assessmentId;
        applyReport(latest.purchase);
      }
    } catch { /* a missing entitlement remains a free-result state */ }
  }
  if (!result.value) error.value = "结果暂不可用，请重新开始测试。";
}

function applyPayment(outcome: any, id: string): void {
  if (!outcome || !active || id !== assessmentId.value) return;
  setPayment({ status: outcome.status, assessmentId: id, busy: false, canRetry: true, ...(outcome.safeCode ? { safeCode: outcome.safeCode } : {}) });
  if (outcome.status === "paid" && outcome.report) applyReport(outcome.report as GoalFitFullReportResponse);
}

async function unlock(): Promise<void> {
  const id = assessmentId.value;
  if (!id || fullReport.value || paymentState.value.busy) return;
  applyPayment(await startManagedGoalFitVirtualPayment({ assessmentId: id }), id);
}

async function resumePendingPaymentForCurrentAssessment(): Promise<void> {
  const id = assessmentId.value;
  if (!active || !id || !result.value || fullReport.value || getPlatform() !== "wechat_miniapp") return;
  try { applyPayment(await resumeManagedGoalFitVirtualPaymentConfirmation({ assessmentId: id }), id); }
  catch { if (active && id === assessmentId.value) paymentMessage.value = "支付结果暂时无法确认，请稍后返回本页查看"; }
}

onLoad((query) => {
  unsubscribe = subscribeGoalFitVirtualPaymentState(setPayment);
  void load(typeof query?.sessionId === "string" ? query.sessionId : "").then(resumePendingPaymentForCurrentAssessment);
});
onShow(() => { void resumePendingPaymentForCurrentAssessment(); });
onUnload(() => { active = false; unsubscribe?.(); if (assessmentId.value) invalidateGoalFitVirtualPaymentFlow({ assessmentId: assessmentId.value }); });
function home(): void { uni.reLaunch({ url: "/pages/index/index" }); }
function retry(): void { uni.reLaunch({ url: "/pages/test-entry/index" }); }
</script>

<template>
  <view class="page">
    <view v-if="result" class="card">
      <text class="score">{{ result.overallScore }} 分</text>
      <text class="title">{{ result.overallConclusion.title }}</text>
      <text class="summary">{{ result.overallConclusion.summary }}</text>
      <text class="section">首要风险</text>
      <text class="risk">{{ result.primaryRisk.title }}</text>
      <text class="summary">{{ result.primaryRisk.description }}</text>
      <view v-if="getPlatform() === 'wechat_miniapp' && !fullReport">
        <button class="primary" :disabled="paymentState.busy" @click="unlock">{{ paymentState.busy ? '正在确认支付结果…' : '解锁完整报告 ¥19.9' }}</button>
        <text v-if="paymentMessage" class="summary">{{ paymentMessage }}</text>
      </view>
      <view v-if="fullReport" class="full-report">
        <text class="section">完整报告</text>
        <text class="title">{{ fullReport.targetCompanyLabel }} · {{ fullReport.targetRoleLabel }}</text>
        <text class="summary">{{ fullReport.overallConclusion.summary }}</text>
        <text class="section">公司适配</text>
        <text class="risk">{{ fullReport.companyQuadrant.title }}</text>
        <text class="summary">{{ fullReport.companyQuadrant.summary }}</text>
        <text class="summary">{{ fullReport.companyQuadrant.advice }}</text>
        <text class="section">岗位适配</text>
        <text class="risk">{{ fullReport.roleQuadrant.title }}</text>
        <text class="summary">{{ fullReport.roleQuadrant.summary }}</text>
        <text class="summary">{{ fullReport.roleQuadrant.advice }}</text>
        <text class="section">风险提示</text>
        <view v-for="risk in fullReport.riskInsights" :key="risk.id"><text class="risk">{{ risk.title }}</text><text class="summary">{{ risk.description }}</text></view>
        <text class="section">行动建议</text>
        <view v-for="recommendation in fullReport.recommendations" :key="recommendation.title"><text class="risk">{{ recommendation.title }}</text><text class="summary">{{ recommendation.description }}</text></view>
        <text class="section">求职顾问建议</text><text class="summary">{{ fullReport.headhunterSummary }}</text>
        <view v-for="card in fullReport.cards" :key="card.id"><text class="section">{{ card.title }}</text><text class="summary">{{ card.summary }}</text><text v-for="item in card.items ?? []" :key="item" class="summary">{{ item }}</text></view>
      </view>
      <button class="primary" @click="home">返回首页</button>
    </view>
    <view v-else class="card"><text class="title">结果暂不可用</text><text class="summary">{{ error }}</text><button class="primary" @click="retry">重新测试</button></view>
  </view>
</template>

<style scoped>
.page{min-height:100vh;padding:48rpx 32rpx;box-sizing:border-box}.card{background:#fff;padding:36rpx;border-radius:24rpx}.score,.title,.summary,.section,.risk{display:block}.score{font-size:64rpx;font-weight:700;color:#4057d6}.title{font-size:40rpx;font-weight:700;margin:20rpx 0}.summary{line-height:1.65;color:#5f6675;white-space:pre-wrap}.section{margin-top:36rpx;font-size:30rpx;font-weight:700}.risk{margin:16rpx 0;font-size:32rpx;font-weight:600}.primary{margin-top:32rpx;background:#4057d6;color:#fff}.full-report{margin-top:16rpx}
</style>
