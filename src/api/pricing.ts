import { request } from "@/api/request";
import type { GoalFitPricing } from "@/types/api";

export function getGoalFitPricing(): Promise<GoalFitPricing> {
  return request<GoalFitPricing>({ path: "/api/pricing/goal-fit-report" });
}
