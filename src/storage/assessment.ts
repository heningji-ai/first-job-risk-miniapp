import { goalFitQuestionBank } from "@/domain/goal-fit/question-bank";
import { selectGoalFitQuestions } from "@/domain/goal-fit/question-selector";
import type { CompanyType, GoalFitAnswerMap, RoleType } from "@/domain/goal-fit/types";

export const ASSESSMENT_DRAFT_KEY = "first_job_goal_fit_assessment_draft_v1";
const companies: CompanyType[] = ["G", "F", "D", "V", "M"];
const roles: RoleType[] = ["SLS", "PM", "OPS", "TECH", "DATA", "FUNC", "MKT", "SUP"];

export interface GoalFitAssessmentDraftV1 {
  schemaVersion: 1;
  questionBankVersion: string;
  sessionId: string;
  step: "company" | "role" | "confirm" | "questions";
  targetCompany: CompanyType | null;
  targetRole: RoleType | null;
  selectedQuestionIds: string[];
  answers: GoalFitAnswerMap;
  currentIndex: number;
  startedAt: string | null;
  updatedAt: string;
}

export type AssessmentTargetSelectionState = {
  step: "company";
  targetCompany: null;
  targetRole: null;
  answers: GoalFitAnswerMap;
  selectedQuestionIds: string[];
  sessionId: null;
};

export function createNewTargetSelectionState(): AssessmentTargetSelectionState {
  return { step: "company", targetCompany: null, targetRole: null, answers: {}, selectedQuestionIds: [], sessionId: null };
}

function now(): string { return new Date().toISOString(); }
export function createAssessmentSessionId(): string { return `assessment_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`; }

export function createAssessmentDraft(targetCompany: CompanyType, targetRole: RoleType): GoalFitAssessmentDraftV1 {
  const timestamp = now();
  return {
    schemaVersion: 1, questionBankVersion: goalFitQuestionBank.version, sessionId: createAssessmentSessionId(),
    step: "questions", targetCompany, targetRole,
    selectedQuestionIds: selectGoalFitQuestions(goalFitQuestionBank, targetRole).map((question) => question.id),
    answers: {}, currentIndex: 0, startedAt: timestamp, updatedAt: timestamp
  };
}

export function validateAssessmentDraft(value: unknown): value is GoalFitAssessmentDraftV1 {
  if (!value || typeof value !== "object") return false;
  const draft = value as GoalFitAssessmentDraftV1;
  if (draft.schemaVersion !== 1 || draft.questionBankVersion !== goalFitQuestionBank.version || !draft.sessionId) return false;
  if (!companies.includes(draft.targetCompany as CompanyType) || !roles.includes(draft.targetRole as RoleType)) return false;
  if (draft.step !== "questions" || !Array.isArray(draft.selectedQuestionIds) || !draft.answers || typeof draft.answers !== "object") return false;
  const targetRole = draft.targetRole as RoleType;
  const selected = selectGoalFitQuestions(goalFitQuestionBank, targetRole).map(({ id }) => id);
  if (JSON.stringify(draft.selectedQuestionIds) !== JSON.stringify(selected) || draft.currentIndex < 0 || draft.currentIndex >= 34) return false;
  const questions = new Map(selectGoalFitQuestions(goalFitQuestionBank, targetRole).map((question) => [question.id, question]));
  return Object.entries(draft.answers).every(([questionId, optionId]) =>
    typeof optionId === "string" && questions.get(questionId)?.options.some((option) => option.id === optionId)
  );
}

function warn(error: unknown): void { if (import.meta.env.DEV) console.warn("[assessment storage] failed", error); }
export function readAssessmentDraft(): GoalFitAssessmentDraftV1 | null {
  try {
    const raw = uni.getStorageSync(ASSESSMENT_DRAFT_KEY);
    if (!raw) return null;
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (validateAssessmentDraft(parsed)) return parsed;
    clearAssessmentDraft();
  } catch (error) { warn(error); }
  return null;
}
export function saveAssessmentDraft(draft: GoalFitAssessmentDraftV1): boolean {
  if (!validateAssessmentDraft(draft)) return false;
  try { uni.setStorageSync(ASSESSMENT_DRAFT_KEY, { ...draft, updatedAt: now() }); return true; } catch (error) { warn(error); return false; }
}
export function clearAssessmentDraft(): void { try { uni.removeStorageSync(ASSESSMENT_DRAFT_KEY); } catch (error) { warn(error); } }
export function hasStartedAnswering(draft: GoalFitAssessmentDraftV1 | null): boolean { return Boolean(draft && Object.keys(draft.answers).length > 0); }
