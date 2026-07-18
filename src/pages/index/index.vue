<script setup lang="ts">
import { onLoad } from "@dcloudio/uni-app";
import { ref } from "vue";
import { trackEvent, trackVisitOnce } from "@/analytics";
import { resolveAttribution } from "@/attribution";
import { getGoalFitPricing } from "@/api/pricing";
import { getPlatform } from "@/platform";
import { getVisitorId } from "@/storage/visitor";

const platform = getPlatform();
const pricingStatus = ref("加载中");

onLoad(async (query) => {
  getVisitorId();
  resolveAttribution(query);
  void trackVisitOnce("/pages/index/index");
  void trackEvent("miniapp_home_view");
  try {
    await getGoalFitPricing();
    pricingStatus.value = "已连接";
  } catch {
    pricingStatus.value = "暂不可用";
  }
});

function start(): void {
  void trackEvent("test_start");
  uni.navigateTo({ url: "/pages/test-entry/index" });
}
</script>

<template>
  <view class="page">
    <view class="card">
      <text class="eyebrow">应届生求职场景预演</text>
      <text class="title">第一份工作预演</text>
      <text class="description">在正式选择之前，先看清目标岗位与自己的匹配风险。</text>
      <view class="status"><text>当前平台</text><text>{{ platform }}</text></view>
      <view class="status"><text>价格接口</text><text>{{ pricingStatus }}</text></view>
      <button class="primary" @click="start">开始预演</button>
    </view>
  </view>
</template>

<style scoped>
.page { min-height: 100vh; padding: 96rpx 36rpx; box-sizing: border-box; }
.card { padding: 48rpx 36rpx; border-radius: 28rpx; background: #fff; box-shadow: 0 16rpx 48rpx rgba(35, 45, 75, .08); }
.eyebrow, .title, .description { display: block; }
.eyebrow { color: #5267d8; font-size: 26rpx; }
.title { margin-top: 18rpx; font-size: 52rpx; font-weight: 700; }
.description { margin: 24rpx 0 44rpx; color: #62697a; font-size: 30rpx; line-height: 1.65; }
.status { display: flex; justify-content: space-between; padding: 22rpx 0; border-top: 1rpx solid #edf0f6; color: #52596a; font-size: 28rpx; }
.primary { margin-top: 44rpx; background: #4057d6; color: #fff; border-radius: 14rpx; }
</style>
