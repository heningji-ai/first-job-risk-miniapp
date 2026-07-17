const DEVELOPMENT_API_BASE_URL = "http://127.0.0.1:3001";
const PRODUCTION_API_BASE_URL = "https://first-job-risk.jobeyes.com";

const configuredBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim();

export const API_BASE_URL = (
  configuredBaseUrl ||
  (import.meta.env.PROD ? PRODUCTION_API_BASE_URL : DEVELOPMENT_API_BASE_URL)
).replace(/\/+$/, "");
