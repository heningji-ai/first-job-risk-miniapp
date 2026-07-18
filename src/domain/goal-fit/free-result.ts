import type { GoalFitResult } from "./types";

export type GoalFitFreeRisk = {
  title: string;
  description: string;
};

export type GoalFitFreeResult = {
  overallScore: number;
  overallConclusion: GoalFitResult["overallConclusion"];
  primaryRisk: GoalFitFreeRisk;
  riskPoints: GoalFitFreeRisk[];
  actionReminder: string;
};

export function projectGoalFitFreeResult(result: GoalFitResult): GoalFitFreeResult {
  const riskPoints = result.riskInsights.slice(0, 3).map(({ title, description }) => ({
    title,
    description
  }));
  const primaryRisk = riskPoints[0];
  const recommendation = result.recommendations[0];

  if (!primaryRisk || !recommendation) {
    throw new Error("Goal Fit result must contain at least one risk and recommendation");
  }

  return {
    overallScore: result.scores.overallScore,
    overallConclusion: result.overallConclusion,
    primaryRisk,
    riskPoints,
    actionReminder: `${recommendation.title}：${recommendation.description}`
  };
}
