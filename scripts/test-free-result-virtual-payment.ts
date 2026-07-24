const fs = require("node:fs");
const source = fs.readFileSync("src/pages/free-result/index.vue", "utf8");
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
for (const token of ["解锁完整报告 ¥19.9", "getPlatform()==='wechat_miniapp'", "startManagedGoalFitVirtualPayment", "resumeManagedGoalFitVirtualPaymentConfirmation", "resumePendingPaymentForCurrentAssessment", "onShow", "subscribeGoalFitVirtualPaymentState", "invalidateGoalFitVirtualPaymentFlow", "paymentState.value.busy", "fullReport.value=outcome.report", "onUnload"]) assert(source.includes(token), `missing ${token}`);
for (const forbidden of ["wx.login", "wx.requestVirtualPayment", "prepareGoalFitVirtualPayment", "confirmGoalFitVirtualPayment", "fetchGoalFitFullReport", "goal-fit-pending-payment", "paymentAttemptId", "requestId", "signData", "paySig", "signature", "productId", "env", "orderId"]) assert(!source.includes(forbidden), `forbidden page payment detail ${forbidden}`);
assert(source.includes("state.assessmentId!==assessmentId.value"), "foreign assessment state must be ignored");
assert(source.includes("!active||id!==assessmentId.value"), "late page result must be ignored");
assert(source.includes("unsubscribe?.()"), "unload must unsubscribe");
assert(!source.includes("clearPending"), "unload must not clear pending storage");
console.log("Free result virtual payment page contract tests passed.");
