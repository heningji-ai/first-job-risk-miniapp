const fs = require("node:fs");
const source = fs.readFileSync("src/pages/free-result/index.vue", "utf8");
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }

for (const token of [
  "result.overallConclusion.title",
  "result.overallConclusion.summary",
  "proof.companyType",
  "proof.roleName",
  "proof.reportTypeTitle",
  "riskPreviews",
  "selectedRiskPreviews.slice(0, 3)",
  "risk-index",
  "valueCounts",
  "riskSceneCount",
  "trainableCount",
  "questionCount",
  "真实工作场景",
  "可提前训练项",
  "面试确认问题",
  "riskPreviews[0].previewShort",
  "入职前准备建议",
  "第一个月行动提醒",
  "¥19.9 解锁你的专属报告",
  "请在安卓微信中完成支付",
  "fixed-cta",
  "safe-area-inset-bottom",
  "ENTITLED_TEMPORARY_UNAVAILABLE",
  "FULL_REPORT_TEMPORARY_UNAVAILABLE",
  "historyMode",
  "hasFreeResult",
  "isRetryableLockedState",
  "showConversionArea",
  "PAYMENT_CANCELLED",
  "PAYMENT_FAILED",
  "正在准备你的专属报告",
  "UNLOCKED_LEGACY",
  "fetchLatestGoalFitPurchase",
  "readGoalFitHistoryReportRecovery",
]) assert(source.includes(token), `missing free-result layout contract: ${token}`);

assert(source.includes("access.value === \"LOCKED\" || access.value === \"PAYMENT_CANCELLED\" || access.value === \"PAYMENT_FAILED\""), "only explicit retryable locked states may show conversion");
assert(source.includes("!historyMode.value && !report.value && hasFreeResult.value && isRetryableLockedState.value"), "conversion area must require a free result and explicit retryable state");
assert(source.includes("showConversionArea.value && isWechatAndroid.value && !!proof.value && !!assessmentId.value"), "Android payment CTA must require complete payment prerequisites");
assert(source.includes("outcome === null && !historyMode.value && !report.value") && source.includes("access.value = \"LOCKED\""), "a no-pending resume must restore a transient payment state to locked");
assert(source.includes("class=\"inline-purchase card\"") && source.includes("class=\"inline-unlock-button\""), "Android conversion must retain a body purchase entry in addition to the fixed CTA");
assert(source.includes("v-if=\"showConversionArea\" class=\"inline-purchase card\""), "every conversion state must render the body purchase card");
assert(source.includes("purchase-value-grid") && source.includes("purchase-price-value"), "the purchase card must render proof counts and the fixed price");
assert(source.includes("v-else-if=\"isWechatAndroid\"") && source.includes("class=\"inline-platform-button\""), "non-Android must display a non-payment platform action while Android without prerequisites prepares eligibility");
assert(source.includes("<view v-if=\"showConversionArea\" class=\"fixed-cta\""), "the fixed CTA must remain visible throughout every conversion state");
assert(source.includes("fixed-value-copy") && source.includes("valueCounts[0].value") && source.includes("valueCounts[1].value") && source.includes("valueCounts[2].value"), "the fixed CTA must render proof-derived value counts from the first screen");
assert(source.includes("<button v-if=\"canPay\" class=\"unlock-button\"") && source.includes("<button v-else class=\"unlock-button\" disabled>"), "only Android canPay may invoke payment while non-Android keeps a disabled product CTA");
assert(source.includes("platform-copy") && source.includes("请在安卓微信中完成支付"), "the Android platform requirement must remain supporting copy, not the primary CTA");
assert(source.includes("proof && !report"), "free preview must be gated from the purchased report renderer");
assert(source.includes("const displayOverallScore = computed<number | null>"), "overall score must be read from the free-result contract and safely normalized for display");
assert(source.includes("result.value?.overallScore"), "overall score must come from the displayed free result");
assert(source.includes("Number.isFinite(score) && score >= 0"), "0 and 100 must remain valid free-result scores while invalid values use the safe fallback");
assert(source.includes("displayOverallScore ?? \"—\""), "an invalid score must not render as NaN or undefined");
assert(source.includes("class=\"overall-score\""), "the conclusion card must render the overall score");
assert(source.includes('overall-score-unit">分</text>'), "the overall score must retain its point unit");
assert(!source.includes("companyFitScore") && !source.includes("roleFitScore"), "free result must not read company or role fit scores");
assert(source.includes("const conversion = computed") && source.includes("v-if=\"conversion\""), "reportConversion must remain only in the purchased renderer");
assert(!source.includes("organizationJudgment") && !source.includes("leaderJudgment"), "do not invent organization-judgment content");
assert(!source.includes("wx.login") && !source.includes("wx.requestVirtualPayment"), "page must delegate payment to the existing controller");
assert(source.includes("<text class=\"home-link\" @click=\"home\">"), "home action must remain a secondary text action");
console.log("Free result visual hierarchy, payment boundary, and legacy recovery tests passed.");
