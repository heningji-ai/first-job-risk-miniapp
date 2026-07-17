<script setup lang="ts">
import { onLoad } from "@dcloudio/uni-app";
import { trackEvent } from "@/analytics";
import { resolveAttribution } from "@/attribution";

onLoad((query) => {
  resolveAttribution(query);
  void trackEvent("miniapp_test_entry_view");
});
</script>

<template>
  <view class="page">
    <text class="title">选择你的目标</text>
    <view class="placeholder"><text class="label">公司类型</text><text>即将开放</text></view>
    <view class="placeholder"><text class="label">岗位方向</text><text>即将开放</text></view>
    <text class="notice">V2.0-A 暂不接入正式题库</text>
  </view>
</template>

<style scoped>
.page { min-height: 100vh; padding: 72rpx 36rpx; box-sizing: border-box; }
.title { display: block; margin-bottom: 42rpx; font-size: 44rpx; font-weight: 700; }
.placeholder { display: flex; justify-content: space-between; margin-bottom: 24rpx; padding: 34rpx; border-radius: 20rpx; background: #fff; color: #969baa; }
.label { color: #303646; font-weight: 600; }
.notice { display: block; margin-top: 44rpx; color: #747b8d; text-align: center; font-size: 26rpx; }
</style>
