<script setup lang="ts">
import { onShow } from "@dcloudio/uni-app";
import { ref } from "vue";
import { fetchGoalFitPurchases, type GoalFitPurchaseListItem } from "@/api/goal-fit-payment";
import { trackEvent } from "@/analytics";
import { ensureWechatMiniappSession } from "@/services/miniapp-session";

const loading = ref(false);
const loaded = ref(false);
const error = ref("");
const purchases = ref<GoalFitPurchaseListItem[]>([]);
let viewTracked = false;
function displayDate(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
async function load(): Promise<void> {
  if (loading.value) return;
  loading.value = true; error.value = "";
  try {
    await ensureWechatMiniappSession();
    const response = await fetchGoalFitPurchases(); purchases.value = response.purchases;
    if (!viewTracked) { viewTracked = true; void trackEvent("goal_fit_my_reports_view", { metadata: { listCount: purchases.value.length } }); }
    if (purchases.value.length === 0) void trackEvent("goal_fit_my_reports_empty");
  } catch { error.value = "报告列表暂时无法加载，请稍后重试。"; void trackEvent("goal_fit_my_reports_load_failed"); }
  finally { loading.value = false; loaded.value = true; }
}
function open(item: GoalFitPurchaseListItem): void { uni.navigateTo({ url: `/pages/free-result/index?assessmentId=${encodeURIComponent(item.assessmentId)}&source=my-reports` }); }
onShow(() => { void load(); });
</script>
<template><view class="page"><view class="card"><text class="title">我的报告</text><text class="summary">已解锁的报告会长期保存在这里。</text><text v-if="loading" class="summary">正在加载报告…</text><view v-else-if="error" class="state"><text class="summary">{{ error }}</text><button class="primary" @click="load">重新加载</button></view><view v-else-if="loaded && purchases.length === 0" class="state"><text class="summary">你还没有已解锁的报告。完成一次职场预演后，可以在这里长期查看。</text></view><view v-else class="list"><button v-for="item in purchases" :key="item.assessmentId" class="report" @click="open(item)"><text class="report-title">{{ item.reportTypeTitle || item.reportType }}</text><text class="summary">{{ item.companyType }} · {{ item.roleName }}</text><text v-if="item.primaryConclusion" class="conclusion">{{ item.primaryConclusion }}</text><text class="summary">{{ displayDate(item.completedAt) }} · {{ item.unlocked ? '已解锁' : '状态确认中' }}</text></button></view></view></view></template>
<style scoped>.page{min-height:100vh;padding:32rpx}.card{padding:32rpx;background:#fff;border-radius:20rpx}.title,.summary,.report-title,.conclusion{display:block}.title{font-size:38rpx;font-weight:700}.summary{line-height:1.65;color:#5f6675;margin-top:10rpx}.state{margin-top:40rpx}.list{margin-top:28rpx}.report{display:block;width:100%;text-align:left;background:#f7f8fc;border:0;border-radius:16rpx;padding:24rpx;margin-top:18rpx}.report-title{font-size:30rpx;font-weight:700}.conclusion{margin-top:12rpx;color:#30384a}.primary{margin-top:22rpx;background:#4057d6;color:#fff}</style>
