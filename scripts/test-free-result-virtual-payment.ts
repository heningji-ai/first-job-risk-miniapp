const fs = require("node:fs");
const source = fs.readFileSync("src/pages/free-result/index.vue", "utf8");
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }

for (const token of [
  "解锁完整报告 ¥19.9", "getPlatform() === 'wechat_miniapp' && !fullReport", "startManagedGoalFitVirtualPayment",
  "resumeManagedGoalFitVirtualPaymentConfirmation", "fetchGoalFitFullReport", "fetchLatestGoalFitPurchase", "applyReport",
  "fullReport.value = response.fullReport", "reportAsFreeResult", "fullReport.companyQuadrant", "fullReport.roleQuadrant",
  "fullReport.riskInsights", "fullReport.recommendations", "fullReport.cards", "onShow", "subscribeGoalFitVirtualPaymentState", "invalidateGoalFitVirtualPaymentFlow", "onUnload",
]) assert(source.includes(token), `missing ${token}`);

assert(source.includes("if (!id || fullReport.value || paymentState.value.busy) return"), "an unlocked report must never start prepare again");
assert(source.includes("if (outcome.status === \"paid\" && outcome.report) applyReport"), "paid confirmation must unpack and render server fullReport");
assert(source.includes("if (assessmentId.value && !fullReport.value) await restoreFullReport"), "page re-entry must recover a purchased report");
assert(source.includes("const latest = await fetchLatestGoalFitPurchase()"), "latest active entitlement must restore after local session loss");
assert(source.includes("state.assessmentId !== assessmentId.value"), "foreign assessment state must be ignored");
assert(source.includes("id !== assessmentId.value"), "late page result must be ignored");
assert(source.includes("unsubscribe?.()"), "unload must unsubscribe");
assert(!source.includes("wx.login") && !source.includes("wx.requestVirtualPayment"), "page must delegate WeChat calls to the controller");
assert(!source.includes("prepareGoalFitVirtualPayment") && !source.includes("confirmGoalFitVirtualPayment"), "page must not call payment prepare/confirm directly");
assert(!source.includes("goal-fit-pending-payment") && !source.includes("paymentAttemptId") && !source.includes("signData"), "page must not manage sensitive payment data");
console.log("Free result virtual payment page contract tests passed.");
