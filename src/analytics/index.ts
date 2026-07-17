import { request } from "@/api/request";
import { resolveAttribution } from "@/attribution";
import { getPlatform } from "@/platform";
import { getSessionId } from "@/storage/session";
import { getVisitorId } from "@/storage/visitor";
import type { AnalyticsContext, AnalyticsEvent, VisitPayload } from "@/types/analytics";

let visitPromise: Promise<void> | null = null;

function warnInDevelopment(message: string, error: unknown): void {
  if (import.meta.env.DEV) console.warn(message, error);
}

function currentPagePath(): string {
  const pages = getCurrentPages();
  const route = pages[pages.length - 1]?.route;
  return route ? `/${route}` : "/pages/index/index";
}

function getContext(): AnalyticsContext {
  const attribution = resolveAttribution();
  return {
    visitorId: getVisitorId(),
    sessionId: getSessionId(),
    platform: getPlatform(),
    ...attribution,
  };
}

export async function trackVisit(landingPath?: string): Promise<void> {
  try {
    const payload: VisitPayload = {
      ...getContext(),
      landingPath: landingPath ?? currentPagePath(),
      landingUrl: null,
      referrer: null,
    };
    await request<unknown, VisitPayload>({ path: "/api/analytics/visit", method: "POST", data: payload });
  } catch (error) {
    warnInDevelopment("[analytics] visit 上报失败", error);
  }
}

export function trackVisitOnce(landingPath?: string): Promise<void> {
  if (!visitPromise) {
    visitPromise = trackVisit(landingPath);
  }
  return visitPromise;
}

export async function trackEvent(
  eventName: string,
  options: { eventValue?: string | number | null; metadata?: Record<string, unknown>; orderId?: string | null } = {},
): Promise<void> {
  try {
    const event: AnalyticsEvent = {
      eventId: `evt_${eventName}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
      ...getContext(),
      orderId: options.orderId ?? null,
      eventName,
      eventValue: options.eventValue ?? null,
      pagePath: currentPagePath(),
      metadata: options.metadata ?? {},
    };
    await request<unknown, { events: AnalyticsEvent[] }>({
      path: "/api/analytics/events",
      method: "POST",
      data: { events: [event] },
    });
  } catch (error) {
    warnInDevelopment(`[analytics] ${eventName || "event"} 上报失败`, error);
  }
}
