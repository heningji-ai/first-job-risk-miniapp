const fs = require("node:fs");
const source = fs.readFileSync("src/pages/free-result/index.vue", "utf8");
const privateEntryConfig = fs.readFileSync("src/config/goal-fit-private-entry.ts", "utf8");
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
  "请在支持虚拟支付的微信客户端中完成支付",
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
  "REFUNDED",
  "FULL_REPORT_REFUNDED",
  "正在准备你的专属报告",
  "UNLOCKED_LEGACY",
  "fetchGoalFitPurchases",
  "reconcilePaymentAndEntitlement",
  "ENTITLED_LOADING",
  "ENTITLED_TEMPORARY_UNAVAILABLE",
  "正在确认付款结果",
  "付款已经完成，请放心，不会重复扣费",
  "重新加载报告",
  "readGoalFitHistoryReportRecovery",
]) assert(source.includes(token), `missing free-result layout contract: ${token}`);

assert(source.includes("access.value === \"LOCKED\" || access.value === \"PAYMENT_CANCELLED\" || access.value === \"PAYMENT_FAILED\""), "only explicit retryable locked states may show conversion");
assert(source.includes("isRefunded") && source.includes("canPurchaseThisHistoryReport"), "refunded history reports must be the sole history-mode repurchase exception");
assert(source.includes("!report.value && hasFreeResult.value") && source.includes("!historyMode.value || canPurchaseThisHistoryReport.value"), "conversion area must require a free result, an explicit purchasable state, and history isolation");
assert(source.includes("const pageState = ref<\"idle\" | \"loading\" | \"ready\" | \"error\">"), "free result must use an explicit loading/ready/error page state");
assert(source.includes("pageState.value === \"ready\"") && source.includes("hasStablePaymentContext") && source.includes("purchaseStateLoaded.value"), "payment CTA must require a ready page and a stable completed assessment context");
assert(source.includes("resultAssessmentId.value === assessmentId.value") && source.includes("proofAssessmentId.value === assessmentId.value") && source.includes("snapshotAssessmentId.value === assessmentId.value"), "payment must require result, proof, and snapshot identity consistency");
assert(source.includes("/^asm_[A-Za-z0-9_-]{8,}$/.test(assessmentId.value)"), "payment must require a formal server assessment id");
assert(source.includes("if (!session && sessionId)") && source.includes("SESSION_NOT_FOUND"), "a missing routed session must not fall back to the latest assessment");
assert(source.includes("route_storage") && source.includes("assessment_context_mismatch"), "route and storage identity mismatches must be rejected and diagnosed");
assert(source.includes("requestVersion !== loadVersion") && source.includes("free.assessmentId !== authoritativeId"), "stale or mismatched async free-result responses must not overwrite the active report");
assert(source.includes("正在生成你的结果……") && source.includes("pageState === 'loading'") && source.includes("结果暂时无法加载"), "initial loading must not render the terminal error state");
assert(source.includes("正在确认购买状态") && source.includes("报告生成中"), "incomplete payment prerequisites must be visibly non-payable");
assert(source.includes("payment_button_enabled") && source.includes("free_result_ready") && source.includes("free_result_page_mounted"), "free result lifecycle diagnostics must be emitted with the result context");
assert(source.includes("setWechatVirtualPaymentDiagnosticReporter((event, options) => trackEvent(event, options))"), "the production-proven page analytics client must inject the payment diagnostic reporter");
assert(source.includes("payment_flow_entered") && source.indexOf("payment_flow_entered") > source.indexOf("goal_fit_report_unlock_click"), "payment flow entry must be recorded after the click and before flow startup");
assert(source.includes("function paymentFlowBlockedReason()") && source.includes("const canPay = computed(() => paymentFlowBlockedReason() === null)"), "button eligibility and handler eligibility must share one payment qualification function");
assert(source.includes("payment_flow_blocked") && source.includes("reportPaymentFlowBlocked(blocked)") && source.includes("UNEXPECTED_HANDLER_ERROR"), "every blocked or synchronous-error path must emit a classified payment_flow_blocked event");
assert(source.indexOf("const blocked = paymentFlowBlockedReason()") > source.indexOf("goal_fit_report_unlock_click") && source.indexOf("payment_flow_entered") < source.indexOf("setAccess(\"PREPARING_PAYMENT\""), "payment state may only begin after the click, shared guard, and flow-entry event");
assert(source.includes('outcome.status === "entitled_pending"') && source.includes('setAccess("ENTITLED_TEMPORARY_UNAVAILABLE")'), "a confirmed payment with a temporarily unavailable report must not become PAYMENT_FAILED");
assert(source.includes('value.status === "entitled_loading"') && source.includes('setAccess("ENTITLED_LOADING")'), "a confirmed payment must enter the entitlement-loading state before report retrieval");
for (const reason of ["PAGE_NOT_READY", "NOT_WECHAT_MINIPROGRAM", "CAPABILITY_UNAVAILABLE", "ASSESSMENT_ID_INVALID", "RESULT_CONTEXT_MISMATCH", "SNAPSHOT_MISSING", "SNAPSHOT_CONTEXT_MISMATCH", "PROOF_MISSING", "PROOF_CONTEXT_MISMATCH", "PURCHASES_NOT_LOADED", "PURCHASE_NOT_ELIGIBLE", "PAYMENT_ALREADY_IN_PROGRESS", "HISTORY_MODE_BLOCKED"]) assert(source.includes(reason), `payment guard reason missing: ${reason}`);
assert(source.includes("assessmentIdSuffix") && source.includes("sessionIdSuffix") && source.includes("reportSnapshotIdSuffix") && source.includes("errorMessageCategory"), "result diagnostics must use only safe identity suffixes and classified errors");
assert(!source.includes("assessment_context_mismatch", source.indexOf("function diagnostic")) || source.includes("contextMatch"), "context mismatch diagnostics must remain classified and must not serialize raw records");
assert(source.includes("fetchGoalFitPurchases") && source.includes("purchases.purchases.find((item) => item.assessmentId === requestedId)"), "pending loss must reconcile against the authoritative assessment-scoped purchases list");
assert(source.includes("Unknown server state is deliberately non-purchasable") && source.includes("ENTITLED_TEMPORARY_UNAVAILABLE"), "an entitlement lookup failure must not reopen purchase");
assert(source.includes("const accessPriority") && source.includes("function setAccess"), "payment access must reject stale lower-priority state writes");
assert(source.includes("getPendingGoalFitPaymentConfirmation") && source.includes("reconcilePaymentAndEntitlement(\"on_show\")"), "onShow must reuse pending confirmation and the unified reconciliation path");
assert(source.includes("retryPaidReport") && source.includes("reconcilePaymentAndEntitlement(\"retry\")"), "report reload must reconcile entitlement without invoking prepare");
assert(source.includes("showPaymentReassurance") && source.includes("正在确认付款结果") && source.includes("付款已完成"), "reassurance modal must derive from entitlement states only");
assert(source.includes("purchaseGuidance") && source.includes("high_risk") && source.includes("good_match") && source.includes("not_priority"), "score-based purchase guidance must use the existing conclusion level only");
for (const guidance of [
  "如果你还准备继续投这个方向，就更不能只凭感觉继续投。完整报告会帮你看清：你最容易在哪些工作场景里吃亏，为什么会被质疑，以及面试和入职前要重点补哪些准备。",
  "这个方向不是不能选，但你不能只看分数就开始投。完整报告会进一步告诉你：你会在哪些工作场景里承压、被挑战，哪些问题需要在面试里提前确认。",
  "分数高，说明这个方向值得继续，但不代表你可以直接盲投。完整报告会帮你把现在的优势变成更有说服力的面试表达，也会提醒你入职后最容易忽略的风险点。",
]) assert(source.includes(guidance), "purchase guidance must render the approved copy for each existing conclusion level");
assert(source.includes("完整报告会继续帮你看清：") && source.indexOf("完整报告会继续帮你看清：") < source.indexOf("purchase-value-grid"), "the purchase card must introduce the proof counts with the approved value title");
assert(source.includes("goalFitPrivateEntryConfig.serviceAccountQrPath") && privateEntryConfig.includes("/static/private-entry/service-account.jpg"), "service-account QR must use the configured original static JPG path");
assert(source.includes("service_account_entry_exposed") && source.includes("service_account_entry_clicked") && source.includes("service_account_qr_previewed"), "service-account analytics must use the unified safe event names");
assert(source.includes("serviceAccountEntryPageState === 'free_result'") && source.includes("serviceAccountEntryPageState === 'full_report'"), "both free result and unlocked full report must expose the same service-account entry");
assert(source.includes("showPaymentReassurance") && source.includes("serviceAccountExposed"), "service-account entry must hide during payment recovery and expose only once per page state");
assert(!source.includes("wecomUrl") && !source.includes("full_report_wecom_clicked"), "WeCom entry must not render in the unified service-account layout");
assert(source.includes("miniappBuildFingerprint") && source.includes("miniapp_build_fingerprint"), "safe build fingerprint diagnostics must be uploaded through analytics");
assert(source.includes("class=\"inline-purchase card\"") && source.includes("class=\"inline-unlock-button\""), "all-terminal conversion must retain a body purchase entry in addition to the fixed CTA");
assert(source.includes("v-if=\"showConversionArea\" class=\"inline-purchase card\""), "every conversion state must render the body purchase card");
assert(source.includes("purchase-value-grid") && source.includes("purchase-price-value"), "the purchase card must render proof counts and the fixed price");
assert(source.includes("paymentCapabilityUnavailable") && source.includes("class=\"inline-platform-button\""), "unsupported WeChat capability must render a safe platform action");
assert(source.includes("<view v-if=\"showConversionArea\" class=\"fixed-cta\""), "the fixed CTA must remain visible throughout every conversion state");
assert(source.includes("fixed-value-copy") && source.includes("valueCounts[0].value") && source.includes("valueCounts[1].value") && source.includes("valueCounts[2].value"), "the fixed CTA must render proof-derived value counts from the first screen");
assert(source.includes("<button v-if=\"canPay\" class=\"unlock-button\"") && source.includes("<button v-else class=\"unlock-button\" disabled>"), "only capability-qualified miniapp payment may invoke the product CTA");
assert(source.includes("请在支持虚拟支付的微信客户端中完成支付"), "unsupported environments must use a neutral virtual-payment prompt");
assert(!source.includes("isWechatAndroid") && !source.includes("安卓微信"), "payment eligibility and copy must not be Android-specific");
assert(source.includes("FULL_REPORT_REFUNDED") && source.includes("function setRefunded") && source.includes('setAccess("REFUNDED", { force: true })'), "refunded full reports must clear report access without exposing cached content");
assert(source.includes("delete next.fullReport"), "refund handling must remove persisted full-report cache");
assert(source.includes("¥19.9 重新解锁专属报告") && source.includes("该报告已退款"), "refunded reports must expose an explicit repurchase state");
assert(source.includes("proof && (!report || (conversion && activePaidView === 'overview'))"), "free preview must render only for the free page or purchased overview view");
assert(source.includes("const displayOverallScore = computed<number | null>"), "overall score must be read from the free-result contract and safely normalized for display");
assert(source.includes("result.value?.overallScore"), "overall score must come from the displayed free result");
assert(source.includes("Number.isFinite(score) && score >= 0"), "0 and 100 must remain valid free-result scores while invalid values use the safe fallback");
assert(source.includes("displayOverallScore ?? \"—\""), "an invalid score must not render as NaN or undefined");
assert(source.includes("class=\"overall-score\""), "the conclusion card must render the overall score");
assert(source.includes('overall-score-unit">分</text>'), "the overall score must retain its point unit");
assert(!source.includes("companyFitScore") && !source.includes("roleFitScore"), "free result must not read company or role fit scores");
assert(source.includes("const conversion = computed") && source.includes("v-if=\"conversion &&"), "reportConversion must remain only in the purchased renderer");
assert(source.includes("const activePaidView = ref<\"overview\" | \"full\">(\"full\")"), "purchased reports must default to the full-report view");
assert(source.includes("conversion && result && proof") && source.includes("结果概览") && source.includes("完整报告"), "unlocked v2 reports with free data must render an overview/full-report switch");
assert(source.includes("function switchPaidView(view: \"overview\" | \"full\")") && source.includes("uni.pageScrollTo({ scrollTop: 0, duration: 0 })"), "switching purchased views must reset the page scroll position");
assert(source.includes("activePaidView.value = \"full\""), "assessment or conversion changes must reset the purchased view to full report");
assert(source.includes("result && (!report || (conversion && activePaidView === 'overview'))"), "paid overview must reuse the existing free-result data rather than report conversion");
assert(source.includes("conversion && (!result || !proof || activePaidView === 'full')"), "full report must remain available when free-result loading fails");
assert(source.includes("fetchGoalFitFreeResult(id)") && source.includes("await readReport(true)"), "history reports must independently load free and full report data");
assert(source.includes("showConversionArea") && source.includes("!report.value"), "purchased overview and full report must not reintroduce a payment entry");
assert(source.includes("overview-card strength-card") && source.includes("overview-card risk-overview-card"), "purchased report strength and risk must render in separate overview blocks");
assert(source.includes("conversion.primaryStrength") && source.includes("conversion.primaryRisk"), "the report overview must keep the authoritative strength and risk fields");
assert(source.includes("v-for=\"(item, index) in conversion.sections\"") && source.includes("class=\"report-section-card card\""), "each report section must render as its own chapter card");
assert(source.includes("const expandedSections = ref<Set<number>>(new Set([0]))") && source.includes("watch([assessmentId, conversion]"), "the first chapter must open by default and reset when the report changes");
assert(source.includes("function toggleSection(index: number)") && source.includes("function isSectionExpanded(index: number)") && source.includes("class=\"section-toggle\""), "the complete chapter header must toggle independently");
assert(source.includes("const next = new Set(expandedSections.value)") && source.includes("next.delete(index)") && source.includes("next.add(index)"), "opening one report section must not collapse other sections");
for (const title of ["工作要求不清时，典型场景会是什么？", "哪些情况最容易让你感受到工作压力？", "哪些工作场景可能让你被挑战，甚至被否定？"]) assert(source.includes(title), `missing clarified report section title: ${title}`);
assert(source.includes("如果你不希望入职后面对这样的压力，面试时需要确认："), "interview questions must include the clarified guidance");
assert(source.includes("如果你入职后面对这样的压力，第一个月应该注意什么？"), "first-month reminders must use the clarified title");
assert(source.includes("displayFirstSevenDaysEntry(entry)") && source.includes("主动向HR索要公司介绍、岗位资料或入职材料"), "first-seven-days guidance must use the HR-supported preparation copy");
assert(!source.includes("拆解一份真实JD或者工作任务"), "obsolete real-JD preparation copy must not render from the current template");
assert(source.includes("查看详细分析 ↓") && source.includes("收起详细分析 ↑"), "chapter controls must have explicit open and close labels");
assert(!source.includes("expanded === index ? '−' : '+'"), "chapter controls must not rely on plus-only affordances");
assert((source.match(/item\.coreExplanation/g) ?? []).length === 2, "core explanation must appear only in the collapsed chapter summary guard and rendering");
for (const field of ["item.scenarios", "item.normalNewcomerReaction", "item.sustainedRisk", "item.trainableParts", "item.firstSevenDays", "item.firstMonthReminder", "item.interviewQuestions"]) assert(source.includes(field), `missing purchased report field rendering: ${field}`);
assert(source.includes("场景0{{ scenarioIndex + 1 }}") && source.includes("情境") && source.includes("反应"), "multiple scenarios must remain separate situation and reaction cards");
assert(!source.includes("item.source") && !source.includes("scenario.interpretation") && !source.includes("item.uncontrollableParts") && !source.includes("item.typeExplanation"), "non-mapped section fields must not be collected into a catch-all supplementary container");
assert(!source.includes("sections[0]"), "empty sections must not dereference a first section");
assert(!source.includes("organizationJudgment") && !source.includes("leaderJudgment"), "do not invent organization-judgment content");
assert(!source.includes("wx.login") && !source.includes("wx.requestVirtualPayment"), "page must delegate payment to the existing controller");
assert(source.includes("<text class=\"home-link\" @click=\"home\">"), "home action must remain a secondary text action");
console.log("Free result visual hierarchy, payment boundary, and legacy recovery tests passed.");
