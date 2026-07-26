import type { GoalFitResult } from "@/domain/goal-fit/types";

export type GoalFitReportScenario = { situation: string; reaction: string; interpretation: string };
export type GoalFitSelectedRiskPreview = { moduleId: string; title: string; previewShort: string };
export type GoalFitReportCounts = { riskSceneCount: number; trainableCount: number; questionCount: number };
export type GoalFitReportValueProof = {
  reportType: string; reportTypeTitle: string; companyType: string; roleName: string; primaryStrength: string; primaryRisk: string;
  selectedRiskModules: string[]; selectedRiskPreviews: GoalFitSelectedRiskPreview[]; avoidancePoints: string[]; gainPoints: string[];
  decisionCopy: string; counts: GoalFitReportCounts; copyVersion: string; mappingVersion: string;
};
export type GoalFitReportConversionSection = {
  moduleId: string; title: string; source: string; coreExplanation: string; scenarios: GoalFitReportScenario[];
  normalNewcomerReaction: string; sustainedRisk: string; trainableParts: string[]; uncontrollableParts: string[];
  firstSevenDays: string[]; firstMonthReminder: string[]; interviewQuestions: string[]; typeExplanation: string;
};
export type GoalFitReportConversion = GoalFitReportValueProof & { sections: GoalFitReportConversionSection[] };
export type GoalFitFullReport = GoalFitResult | { reportConversion: GoalFitReportConversion };
export type GoalFitFullReportResponse = { assessmentId: string; reportSnapshotId: string; fullReport: GoalFitFullReport };
/** A server-authoritative purchased-report record. It never contains report content. */
export type GoalFitPurchaseListItem = {
  assessmentId: string;
  reportSnapshotId: string;
  reportType: string;
  reportTypeTitle: string | null;
  companyType: string;
  roleName: string;
  completedAt: string;
  primaryConclusion: string | null;
  unlocked: true;
  copyVersion: string | null;
  mappingVersion: string | null;
};
export type GoalFitPurchaseListResponse = { purchases: GoalFitPurchaseListItem[] };
export type GoalFitFreeResultResponse = { assessmentId: string; reportSnapshotId: string; freeResult: { overallScore: number; overallConclusion: GoalFitResult["overallConclusion"]; primaryRisk: { title: string; description: string }; riskInsights: Array<{ title: string; description: string }>; recommendations: Array<{ title: string; description: string }>; reportValueProof?: GoalFitReportValueProof }; completedAt?: string; versions?: Record<string, string | null> };
export type GoalFitApiError = "FULL_REPORT_NOT_ENTITLED" | "FULL_REPORT_TEMPORARY_UNAVAILABLE";
export function hasReportConversion(value: GoalFitFullReport): value is { reportConversion: GoalFitReportConversion } { return "reportConversion" in value && Boolean(value.reportConversion); }
