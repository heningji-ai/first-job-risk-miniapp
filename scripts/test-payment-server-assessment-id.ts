import assert from "node:assert/strict";

const officialAssessmentId = "asm_server_test_1234567890";
const localAssessmentId = "assessment_1784983968808_rvu1b4sp";
const freeResult = {
  overallScore: 80,
  overallConclusion: { level: "good_match", title: "ok", summary: "ok" },
  primaryRisk: { title: "risk", description: "risk" },
  riskInsights: [{ title: "risk", description: "risk" }],
  recommendations: [{ title: "action", description: "action" }],
};
const answers = Object.fromEntries(Array.from({ length: 34 }, (_, index) => [`Q${index}`, "O1"]));

const { setAssessmentSyncDepsForTest, syncCompletedAssessment } = require("@/services/assessment-sync") as typeof import("@/services/assessment-sync");
const {
  fetchGoalFitFullReport,
  prepareGoalFitVirtualPayment,
  setGoalFitPaymentRequestClientForTest,
} = require("@/api/goal-fit-payment") as typeof import("@/api/goal-fit-payment");

async function main(): Promise<void> {
  let current: any = {
    schemaVersion: 1,
    id: localAssessmentId,
    submissionId: "sub_server_assessment_id_regression",
    targetCompany: "D",
    targetRole: "PM",
    selectedQuestionIds: Object.keys(answers),
    answers,
    localFreeResult: freeResult,
    syncStatus: "pending",
    syncAttempts: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:00:00.000Z",
  };

  try {
    setAssessmentSyncDepsForTest({
      platform: () => "wechat_miniapp",
      ensureSession: async () => {},
      request: async () => ({
        assessmentId: officialAssessmentId,
        reportSnapshotId: "rpt_server_test_1234567890",
        freeResult,
        versions: { questionSetVersion: "q", scoringVersion: "s", reportVersion: "r" },
      }),
      read: () => current,
      save: (value) => {
        current = value;
        return true;
      },
      now: () => "2026-01-01T00:00:01.000Z",
    });

    const synced = await syncCompletedAssessment();
    assert.equal(synced?.assessmentId, officialAssessmentId);
    assert.equal(current.assessmentId, officialAssessmentId);
    assert.equal(current.id, localAssessmentId, "the local session ID must remain distinct from the server ID");

    const paths: string[] = [];
    setGoalFitPaymentRequestClientForTest(async (options: any) => {
      paths.push(options.path);
      if (options.path.endsWith("/virtual-payment-params")) {
        return {
          orderId: "ord_server_test_1234567890",
          paymentAttemptId: "pat_server_test_1234567890",
          mode: "short_series_goods",
          signData: "opaque-sign-data",
          paySig: "opaque-pay-sig",
          signature: "opaque-signature",
        };
      }
      return { sections: [] };
    });

    await prepareGoalFitVirtualPayment(synced!.assessmentId!, { code: "code", requestId: "request" });
    await fetchGoalFitFullReport(synced!.assessmentId!);

    assert.deepEqual(paths, [
      `/api/miniapp/goal-fit/assessments/${officialAssessmentId}/virtual-payment-params`,
      `/api/miniapp/goal-fit/assessments/${officialAssessmentId}/full-report`,
    ]);
    assert(paths.every((path) => !path.includes(localAssessmentId)));
  } finally {
    setAssessmentSyncDepsForTest(null);
    setGoalFitPaymentRequestClientForTest();
  }

  console.log("Server assessment ID payment regression tests passed.");
}

void main();
