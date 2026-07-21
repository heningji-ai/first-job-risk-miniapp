<script setup lang="ts">
import { onLaunch } from "@dcloudio/uni-app";
import { resolveAttribution } from "@/attribution";
import { getPlatform } from "@/platform";
import { getVisitorId } from "@/storage/visitor";
import { ensureWechatMiniappSession } from "@/services/miniapp-session";

onLaunch((options) => {
  getPlatform();
  getVisitorId();
  void ensureWechatMiniappSession();
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
