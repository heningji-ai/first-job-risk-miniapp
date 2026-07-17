export interface ApiErrorOptions {
  statusCode?: number;
  cause?: unknown;
}

export interface GoalFitPricing {
  price?: number;
  currency?: string;
  [key: string]: unknown;
}
