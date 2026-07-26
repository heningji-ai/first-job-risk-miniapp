const STORAGE_KEY = "goal_fit_history_report_recovery_v1";
const ASSESSMENT_ID_PATTERN = /^asm_[A-Za-z0-9_-]{8,}$/;

export type GoalFitHistoryReportRecovery = {
  assessmentId: string;
  recoveryPending: boolean;
};

function isRecovery(value: unknown): value is GoalFitHistoryReportRecovery {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return ASSESSMENT_ID_PATTERN.test(String(item.assessmentId)) && typeof item.recoveryPending === "boolean";
}

export function readGoalFitHistoryReportRecovery(): GoalFitHistoryReportRecovery | null {
  try {
    const value = uni.getStorageSync(STORAGE_KEY) as unknown;
    if (!isRecovery(value)) {
      if (value !== undefined && value !== null && value !== "") uni.removeStorageSync(STORAGE_KEY);
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

export function saveGoalFitHistoryReportRecovery(value: GoalFitHistoryReportRecovery): void {
  if (!isRecovery(value)) return;
  try { uni.setStorageSync(STORAGE_KEY, value); } catch { /* storage is optional for recovery */ }
}

export function clearGoalFitHistoryReportRecovery(assessmentId?: string): void {
  try {
    const current = readGoalFitHistoryReportRecovery();
    if (!assessmentId || current?.assessmentId === assessmentId) uni.removeStorageSync(STORAGE_KEY);
  } catch { /* storage is optional for recovery */ }
}
