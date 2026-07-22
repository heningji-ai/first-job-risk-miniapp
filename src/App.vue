<script setup lang="ts">
import { onLaunch } from "@dcloudio/uni-app";
import { resolveAttribution } from "@/attribution";
import { getPlatform } from "@/platform";
import { getVisitorId } from "@/storage/visitor";
import { ensureWechatMiniappSession } from "@/services/miniapp-session";
import { retryPendingAssessmentSyncOnce } from "@/services/assessment-sync";

onLaunch((options) => {
  getPlatform();
  getVisitorId();
  void ensureWechatMiniappSession().then(() => retryPendingAssessmentSyncOnce());
  resolveAttribution(options?.query);
});
</script>

<style>
page {
  background: #f6f7fb;
  color: #202431;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
</style>
