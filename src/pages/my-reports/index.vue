<script setup lang="ts">
import { onShow } from "@dcloudio/uni-app";
import { ref } from "vue";
import { fetchGoalFitPurchases, type GoalFitPurchaseListItem } from "@/api/goal-fit-payment";
import { ApiError } from "@/api/request";
import { trackEvent } from "@/analytics";
import { getPlatform } from "@/platform";
import { ensureWechatMiniappSession, forceRefreshWechatMiniappSession, MiniappSessionRefreshError } from "@/services/miniapp-session";
import { getVisitorId } from "@/storage/visitor";

type ViewState = "loading" | "empty" | "auth_error" | "network_error" | "server_error" | "success";
const state = ref<ViewState>("loading"); const purchases = ref<GoalFitPurchaseListItem[]>([]); let viewTracked = false;
const suffix = (value: string | undefined): string | undefined => value?.slice(-6);
function displayDate(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
function diagnostic(requestPhase: string, extra: Record<string, string | number | undefined> = {}): void { void trackEvent("goal_fit_my_reports_recovery", { metadata: { platform: getPlatform(), requestPhase, visitorIdSuffix: suffix(getVisitorId()), platformIdentityIdSuffix: undefined, assessmentIdSuffix: undefined, reportCount: purchases.value.length, callbackAt: Date.now(), ...extra } }); }
function isAuthError(error: unknown): boolean { return error instanceof ApiError && (error.statusCode === 401 || error.message === "MINIAPP_SESSION_EXPIRED" || error.message === "MINIAPP_AUTH_REQUIRED"); }
async function load(retryCount = 0): Promise<void> {
  state.value = "loading";
  try {
    diagnostic("session_ensure", { retryCount, sessionAction: retryCount ? "forced_refresh" : "reuse" });
    await (retryCount ? forceRefreshWechatMiniappSession() : ensureWechatMiniappSession());
    diagnostic("purchases_request", { retryCount });
    const response = await fetchGoalFitPurchases(); purchases.value = response.purchases;
    state.value = purchases.value.length ? "success" : "empty";
    diagnostic("purchases_success", { retryCount });
    if (!viewTracked) { viewTracked = true; void trackEvent("goal_fit_my_reports_view", { metadata: { listCount: purchases.value.length } }); }
    if (!purchases.value.length) void trackEvent("goal_fit_my_reports_empty");
  } catch (error) {
    const httpStatus = error instanceof ApiError ? error.statusCode : undefined;
    const businessErrorCode = error instanceof ApiError ? error.message : undefined;
    if (isAuthError(error) && retryCount === 0) { diagnostic("purchases_401_retry", { retryCount, httpStatus, businessErrorCode, refreshReason: "provider_401" }); return load(1); }
    state.value = error instanceof MiniappSessionRefreshError || isAuthError(error) ? "auth_error" : httpStatus === undefined || httpStatus === 0 ? "network_error" : "server_error";
    diagnostic("purchases_failed", { retryCount, httpStatus, businessErrorCode });
  }
}
function open(item: GoalFitPurchaseListItem): void { uni.navigateTo({ url: `/pages/free-result/index?assessmentId=${encodeURIComponent(item.assessmentId)}&source=my-reports` }); }
onShow(() => { void load(); });
</script>
<template><view class="page"><view class="card"><text class="title">我的报告</text><text class="summary">报告记录会长期保存在这里。</text><text v-if="state === 'loading'" class="summary">正在加载报告…</text><view v-else-if="state === 'auth_error'" class="state"><text class="summary">登录状态恢复失败，请重试</text><button class="primary" @click="() => load()">重新加载</button></view><view v-else-if="state === 'network_error'" class="state"><text class="summary">网络连接异常，请重试</text><button class="primary" @click="() => load()">重新加载</button></view><view v-else-if="state === 'server_error'" class="state"><text class="summary">报告列表暂时无法加载，请稍后重试</text><button class="primary" @click="() => load()">重新加载</button></view><view v-else-if="state === 'empty'" class="state"><text class="summary">暂无报告记录</text></view><view v-else class="list"><button v-for="item in purchases" :key="item.assessmentId" class="report" @click="open(item)"><text class="report-title">{{ item.reportTypeTitle || item.reportType }}</text><text class="summary">{{ item.companyType }} · {{ item.roleName }}</text><text v-if="item.primaryConclusion" class="conclusion">{{ item.primaryConclusion }}</text><text class="summary">{{ displayDate(item.completedAt) }} · {{ item.status === 'REFUNDED' ? '已退款' : item.unlocked ? '已解锁' : '状态确认中' }}</text></button></view></view></view></template>
<style scoped>.page{min-height:100vh;padding:32rpx}.card{padding:32rpx;background:#fff;border-radius:20rpx}.title,.summary,.report-title,.conclusion{display:block}.title{font-size:38rpx;font-weight:700}.summary{line-height:1.65;color:#5f6675;margin-top:10rpx}.state{margin-top:40rpx}.list{margin-top:28rpx}.report{display:block;width:100%;text-align:left;background:#f7f8fc;border:0;border-radius:16rpx;padding:24rpx;margin-top:18rpx}.report-title{font-size:30rpx;font-weight:700}.conclusion{margin-top:12rpx;color:#30384a}.primary{margin-top:22rpx;background:#4057d6;color:#fff}</style>
