import { defineConfig, loadEnv } from "vite";
import uni from "@dcloudio/vite-plugin-uni";

const PRODUCTION_API_BASE_URL = "https://first-job-risk.jobeyes.com";

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const configuredApiBaseUrl = process.env.VITE_API_BASE_URL ?? env.VITE_API_BASE_URL;
  const configuredBaseUrl = configuredApiBaseUrl?.trim();
  if (command === "build" && mode === "production" && configuredApiBaseUrl !== undefined && configuredBaseUrl !== PRODUCTION_API_BASE_URL) {
    throw new Error("Production VITE_API_BASE_URL must be https://first-job-risk.jobeyes.com");
  }
  return { plugins: [uni()] };
});
