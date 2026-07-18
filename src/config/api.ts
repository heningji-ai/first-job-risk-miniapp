const DEVELOPMENT_API_BASE_URL = "http://127.0.0.1:3001";
const PRODUCTION_API_BASE_URL = "https://first-job-risk.jobeyes.com";

const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL;
const configuredBaseUrl = configuredApiBaseUrl?.trim();

if (import.meta.env.PROD && configuredApiBaseUrl !== undefined && configuredBaseUrl !== PRODUCTION_API_BASE_URL) {
  throw new Error("Production VITE_API_BASE_URL must be https://first-job-risk.jobeyes.com");
}

export const API_BASE_URL = (
  (import.meta.env.PROD ? undefined : configuredBaseUrl) ||
  (import.meta.env.PROD ? PRODUCTION_API_BASE_URL : DEVELOPMENT_API_BASE_URL)
).replace(/\/+$/, "");
