<script setup lang="ts">
import { onLoad } from "@dcloudio/uni-app";
import { computed, ref } from "vue";
import { trackEvent } from "@/analytics";
import { goalFitQuestionBank } from "@/domain/goal-fit/question-bank";
import { selectGoalFitQuestions } from "@/domain/goal-fit/question-selector";
import { calculateGoalFitScores } from "@/domain/goal-fit/scoring-engine";
import { buildGoalFitResult } from "@/domain/goal-fit/result-builder";
import { clearAssessmentDraft, readAssessmentDraft, saveAssessmentDraft, type GoalFitAssessmentDraftV1 } from "@/storage/assessment";
import { createSubmissionId, saveCompletedSession, type GoalFitCompletedSessionV1 } from "@/storage/goal-fit-session";
import { syncCompletedAssessment } from "@/services/assessment-sync";

const draft = ref<GoalFitAssessmentDraftV1 | null>(null);
const submitting = ref(false);
const submitError = ref("");
let completedSession: GoalFitCompletedSessionV1 | null = null;
let resultNavigationStarted = false;

const questions = computed(() => draft.value ? selectGoalFitQuestions(goalFitQuestionBank, draft.value.targetRole!) : []);
const question = computed(() => questions.value[draft.value?.currentIndex ?? 0]);
const answered = computed(() => draft.value ? Object.keys(draft.value.answers).length : 0);

onLoad(() => {
  draft.value = readAssessmentDraft();
  if (!draft.value) uni.redirectTo({ url: "/pages/test-entry/index" });
});

function suffix(value: string | undefined): string | undefined { return value?.slice(-6); }
function diagnostic(event: "assessment_submit_started" | "assessment_submit_succeeded" | "assessment_submit_failed", value: Pick<GoalFitCompletedSessionV1, "id" | "assessmentId" | "reportSnapshotId">, errorMessageCategory?: string): void {
  void trackEvent(event, { metadata: { assessmentIdSuffix: suffix(value.assessmentId), sessionIdSuffix: suffix(value.id), reportSnapshotIdSuffix: suffix(value.reportSnapshotId), pageState: submitting.value ? "loading" : "error", errorMessageCategory } });
}
function hasOfficialResult(value: GoalFitCompletedSessionV1 | null): value is GoalFitCompletedSessionV1 & { assessmentId: string; reportSnapshotId: string; serverFreeResult: NonNullable<GoalFitCompletedSessionV1["serverFreeResult"]> } {
  return Boolean(value && /^asm_[A-Za-z0-9_-]{8,}$/.test(value.assessmentId ?? "") && /^rpt_[A-Za-z0-9_-]{8,}$/.test(value.reportSnapshotId ?? "") && value.serverFreeResult?.reportValueProof);
}
function choose(id: string): void {
  if (!draft.value || !question.value || submitting.value) return;
  draft.value.answers[question.value.id] = id;
  saveAssessmentDraft(draft.value);
}
function previous(): void {
  if (draft.value && !submitting.value && draft.value.currentIndex > 0) {
    draft.value.currentIndex--;
    saveAssessmentDraft(draft.value);
  }
}
function next(): void {
  if (!draft.value || !question.value || !draft.value.answers[question.value.id]) {
    uni.showToast({ title: "请选择一个选项", icon: "none" });
    return;
  }
  if (draft.value.currentIndex < 33) {
    draft.value.currentIndex++;
    saveAssessmentDraft(draft.value);
    return;
  }
  void submit();
}
async function submit(): Promise<void> {
  if (!draft.value || submitting.value || resultNavigationStarted || answered.value !== 34 || questions.value.some((item) => !draft.value!.answers[item.id])) {
    uni.showToast({ title: "请完成全部 34 题", icon: "none" });
    return;
  }
  submitting.value = true;
  submitError.value = "";
  try {
    const saved = draft.value;
    if (!completedSession) {
      const answers = Object.fromEntries(questions.value.map((item) => [item.id, saved.answers[item.id]]));
      const scores = calculateGoalFitScores({ questionBank: goalFitQuestionBank, answers, targetCompany: saved.targetCompany!, targetRole: saved.targetRole! });
      const result = buildGoalFitResult({ questionBank: goalFitQuestionBank, answers, targetCompany: saved.targetCompany!, targetRole: saved.targetRole! });
      const localFreeResult = { overallScore: result.scores.overallScore, overallConclusion: result.overallConclusion, primaryRisk: result.riskInsights[0], riskInsights: result.riskInsights, recommendations: result.recommendations };
      completedSession = { schemaVersion: 1, id: saved.sessionId, submissionId: createSubmissionId(), targetCompany: saved.targetCompany!, targetRole: saved.targetRole!, selectedQuestionIds: saved.selectedQuestionIds, answers, scores, result, localFreeResult, syncStatus: "pending", syncAttempts: 0, createdAt: saved.startedAt!, completedAt: new Date().toISOString() };
      if (!saveCompletedSession(completedSession)) throw new Error("ASSESSMENT_SESSION_SAVE_FAILED");
    }
    diagnostic("assessment_submit_started", completedSession);
    const synced = await syncCompletedAssessment(completedSession);
    if (!hasOfficialResult(synced)) {
      diagnostic("assessment_submit_failed", completedSession, "ASSESSMENT_SYNC_INCOMPLETE");
      submitError.value = "结果生成暂未完成，请重新生成结果";
      return;
    }
    completedSession = synced;
    if (!saveCompletedSession(synced)) throw new Error("ASSESSMENT_SESSION_SAVE_FAILED");
    clearAssessmentDraft();
    diagnostic("assessment_submit_succeeded", synced);
    void trackEvent("test_complete", { metadata: { answeredCount: 34, scoreVersion: synced.scores?.scoreVersion, resultVersion: synced.result?.resultVersion } });
    resultNavigationStarted = true;
    uni.redirectTo({ url: `/pages/free-result/index?assessmentId=${encodeURIComponent(synced.assessmentId)}&sessionId=${encodeURIComponent(synced.id)}` });
  } catch {
    submitError.value = "结果生成失败，请重新生成结果";
    diagnostic("assessment_submit_failed", completedSession ?? { id: draft.value.sessionId }, "ASSESSMENT_SAVE_FAILED");
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <scroll-view v-if="draft && question" scroll-y class="page">
    <view class="card">
      <text class="progress">{{ draft.currentIndex + 1 }}/34 · 已答 {{ answered }}/34</text>
      <view class="bar"><view class="fill" :style="{ width: `${answered / 34 * 100}%` }" /></view>
      <text class="module">{{ question.module }}</text>
      <text class="title">{{ question.text }}</text>
      <view v-for="option in question.options" :key="option.id" class="option" :class="{ selected: draft.answers[question.id] === option.id }" @click="choose(option.id)"><text>{{ option.text }}</text></view>
      <view v-if="submitting" class="generating">正在生成你的结果……</view>
      <view v-if="submitError" class="submit-error"><text>{{ submitError }}</text><text class="retry-link" @click="submit">重新生成结果</text></view>
      <view class="actions"><button :disabled="draft.currentIndex === 0 || submitting" @click="previous">上一题</button><button class="primary" :loading="submitting" :disabled="submitting" @click="next">{{ draft.currentIndex === 33 ? "查看结果" : "下一题" }}</button></view>
    </view>
  </scroll-view>
</template>

<style scoped>
.page{height:100vh}.card{padding:40rpx 32rpx 80rpx}.progress,.module,.title{display:block}.progress,.module{color:#667085;font-size:26rpx}.bar{height:12rpx;background:#edf0f6;border-radius:8rpx;margin:18rpx 0 36rpx}.fill{height:100%;background:#4057d6;border-radius:8rpx}.title{font-size:38rpx;font-weight:700;line-height:1.55;margin:16rpx 0 32rpx}.option{padding:28rpx;margin:18rpx 0;border:2rpx solid #e3e7ef;border-radius:16rpx;line-height:1.55}.selected{border-color:#4057d6;background:#f0f3ff}.actions{display:flex;gap:20rpx;margin-top:40rpx}.actions button{flex:1}.primary{background:#4057d6;color:#fff}.generating,.submit-error{margin-top:26rpx;padding:20rpx;border-radius:14rpx;background:#f2f4ff;color:#4057d6;font-size:27rpx}.submit-error{background:#fff6f2;color:#8a4b35}.retry-link{display:block;margin-top:12rpx;color:#4057d6;font-weight:600}
</style>
