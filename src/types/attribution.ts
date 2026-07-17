export interface Attribution {
  source: string;
  channel: string;
  campaign: string;
  referralCode: string | null;
}

export type AttributionQuery = Record<string, unknown> | undefined | null;
