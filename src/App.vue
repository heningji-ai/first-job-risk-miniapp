<script setup lang="ts">
import { onLaunch } from "@dcloudio/uni-app";
import { resolveAttribution } from "@/attribution";
import { getPlatform } from "@/platform";
import { getVisitorId } from "@/storage/visitor";

onLaunch((options) => {
  getPlatform();
  getVisitorId();
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
