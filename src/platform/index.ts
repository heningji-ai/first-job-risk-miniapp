import type { MiniappPlatform } from "@/types/platform";

export function getPlatform(): MiniappPlatform {
  // #ifdef MP-WEIXIN
  return "wechat_miniapp";
  // #endif
  // #ifdef MP-TOUTIAO
  return "douyin_miniapp";
  // #endif
  // #ifdef MP-XHS
  return "xiaohongshu_miniapp";
  // #endif
  // #ifdef H5
  return "h5";
  // #endif
  return "unknown";
}
