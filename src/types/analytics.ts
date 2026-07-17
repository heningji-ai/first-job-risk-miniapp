import type { MiniappPlatform } from "@/types/platform";

export interface AnalyticsContext {
  visitorId: string;
  sessionId: string;
  platform: MiniappPlatform;
  source: string;
  channel: string;
  campaign: string;
  referralCode: string | null;
}

export interface VisitPayload extends AnalyticsContext {
  landingPath: string;
  landingUrl: string | null;
  referrer: string | null;
}

export interface AnalyticsEvent extends AnalyticsContext {
  eventId: string;
  orderId: string | null;
  eventName: string;
  eventValue: string | number | null;
  pagePath: string;
  metadata: Record<string, unknown>;
}
