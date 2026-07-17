const VISITOR_ID_STORAGE_KEY = "first_job_goal_fit_miniapp_visitor_id_v1";
let cachedVisitorId: string | null = null;

function warnStorageFailure(operation: "read" | "write", error: unknown): void {
  if (import.meta.env.DEV) {
    console.warn(`[storage] visitorId ${operation} failed`, error);
  }
}

function createVisitorId(): string {
  return `visitor_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
}

export function getVisitorId(): string {
  if (cachedVisitorId) return cachedVisitorId;

  try {
    const savedVisitorId = uni.getStorageSync(VISITOR_ID_STORAGE_KEY);
    if (typeof savedVisitorId === "string" && savedVisitorId.startsWith("visitor_")) {
      cachedVisitorId = savedVisitorId;
      return cachedVisitorId;
    }
  } catch (error) {
    warnStorageFailure("read", error);
  }

  cachedVisitorId = createVisitorId();
  try {
    uni.setStorageSync(VISITOR_ID_STORAGE_KEY, cachedVisitorId);
  } catch (error) {
    warnStorageFailure("write", error);
  }
  return cachedVisitorId;
}
