/**
 * Deployment-owned destinations. Keep production URLs or QR payloads in the
 * build environment; an absent entry simply hides its corresponding UI.
 */
function optionalUrl(value: unknown): string | null {
  return typeof value === "string" && /^(https:|\/pages\/)/.test(value) ? value : null;
}

export const goalFitPrivateEntryConfig = {
  wecomUrl: optionalUrl(import.meta.env.VITE_GOAL_FIT_WECOM_ENTRY_URL),
  serviceAccountUrl: optionalUrl(import.meta.env.VITE_GOAL_FIT_SERVICE_ACCOUNT_ENTRY_URL),
} as const;
