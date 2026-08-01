import { defineConfig, loadEnv } from "vite";
import uni from "@dcloudio/vite-plugin-uni";
import { execFileSync } from "node:child_process";

const PRODUCTION_API_BASE_URL = "https://first-job-risk.jobeyes.com";

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const configuredApiBaseUrl = process.env.VITE_API_BASE_URL ?? env.VITE_API_BASE_URL;
  const configuredBaseUrl = configuredApiBaseUrl?.trim();
  if (command === "build" && mode === "production" && configuredApiBaseUrl !== undefined && configuredBaseUrl !== PRODUCTION_API_BASE_URL) {
    throw new Error("Production VITE_API_BASE_URL must be https://first-job-risk.jobeyes.com");
  }
  const gitCommit = process.env.MINIAPP_BUILD_GIT_COMMIT
    ?? (() => { try { return execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim(); } catch { return "unknown"; } })();
  return {
    plugins: [uni()],
    define: {
      __MINIAPP_BUILD_FINGERPRINT__: JSON.stringify({
        appVersion: process.env.MINIAPP_APP_VERSION ?? "2.1.1",
        gitCommit,
        buildAt: process.env.MINIAPP_BUILD_AT ?? new Date().toISOString(),
      }),
    },
  };
});
