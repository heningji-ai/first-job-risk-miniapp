import type { GoalFitAnswerMap, GoalFitResult, GoalFitScoreResult, CompanyType, RoleType } from "@/domain/goal-fit/types";

const KEY = "first_job_goal_fit_completed_session_v1";
export interface GoalFitCompletedSessionV1 {
  schemaVersion: 1; id: string; targetCompany: CompanyType; targetRole: RoleType; selectedQuestionIds: string[];
  answers: GoalFitAnswerMap; scores: GoalFitScoreResult; result: GoalFitResult; createdAt: string; completedAt: string;
}
export function validateCompletedSession(value: unknown): value is GoalFitCompletedSessionV1 {
  const item = value as GoalFitCompletedSessionV1;
  return Boolean(item && item.schemaVersion === 1 && item.id && item.result && item.scores && item.result.resultVersion && item.scores.scoreVersion);
}
function warn(error: unknown): void { if (import.meta.env.DEV) console.warn("[goal fit session] failed", error); }
export function saveCompletedSession(session: GoalFitCompletedSessionV1): boolean {
  if (!validateCompletedSession(session)) return false;
  try { uni.setStorageSync(KEY, session); return true; } catch (error) { warn(error); return false; }
}
export function readCompletedSession(id: string): GoalFitCompletedSessionV1 | null {
  try { const item = uni.getStorageSync(KEY); return validateCompletedSession(item) && item.id === id ? item : null; } catch (error) { warn(error); return null; }
}
