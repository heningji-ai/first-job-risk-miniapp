import type { Attribution, AttributionQuery } from "@/types/attribution";

const ATTRIBUTION_STORAGE_KEY = "first_job_goal_fit_miniapp_attribution_v1";
const DEFAULT_ATTRIBUTION: Attribution = {
  source: "direct",
  channel: "organic",
  campaign: "none",
  referralCode: null,
};
let cachedAttribution: Attribution | null = null;

function warnStorageFailure(operation: "read" | "write", error: unknown): void {
  if (import.meta.env.DEV) {
    console.warn(`[storage] attribution ${operation} failed`, error);
  }
}

function clean(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function readStoredAttribution(): Attribution {
  if (cachedAttribution) return { ...cachedAttribution };

  try {
    const saved = uni.getStorageSync(ATTRIBUTION_STORAGE_KEY) as Partial<Attribution> | undefined;
    if (saved && typeof saved === "object" && !Array.isArray(saved)) {
      cachedAttribution = {
        source: clean(saved.source) ?? DEFAULT_ATTRIBUTION.source,
        channel: clean(saved.channel) ?? DEFAULT_ATTRIBUTION.channel,
        campaign: clean(saved.campaign) ?? DEFAULT_ATTRIBUTION.campaign,
        referralCode: clean(saved.referralCode),
      };
      return { ...cachedAttribution };
    }
  } catch (error) {
    warnStorageFailure("read", error);
  }

  cachedAttribution = { ...DEFAULT_ATTRIBUTION };
  return { ...cachedAttribution };
}

function saveAttribution(attribution: Attribution): void {
  cachedAttribution = { ...attribution };
  try {
    uni.setStorageSync(ATTRIBUTION_STORAGE_KEY, cachedAttribution);
  } catch (error) {
    warnStorageFailure("write", error);
  }
}

export function resolveAttribution(query?: AttributionQuery): Attribution {
  const current = readStoredAttribution();
  const source = clean(query?.source);
  const channel = clean(query?.channel);
  const campaign = clean(query?.campaign);
  const referralCode = clean(query?.ref);
  const hasNewAttribution = Boolean(source || channel || campaign || referralCode);

  if (!hasNewAttribution) return current;

  const attribution: Attribution = {
    source: source ?? current.source,
    channel: channel ?? current.channel,
    campaign: campaign ?? current.campaign,
    referralCode: referralCode ?? current.referralCode,
  };
  saveAttribution(attribution);
  return attribution;
}
