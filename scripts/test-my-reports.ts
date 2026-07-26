const fs = require("node:fs");
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const home = fs.readFileSync("src/pages/index/index.vue", "utf8");
const list = fs.readFileSync("src/pages/my-reports/index.vue", "utf8");
const detail = fs.readFileSync("src/pages/free-result/index.vue", "utf8");
const routes = fs.readFileSync("src/pages.json", "utf8");

for (const token of ["我的报告", "/pages/my-reports/index"]) assert(home.includes(token), `home entry missing ${token}`);
for (const token of ["fetchGoalFitPurchases", "onShow", "reportTypeTitle", "companyType", "roleName", "completedAt", "primaryConclusion", "item.unlocked", "重新加载", "assessmentId=${encodeURIComponent(item.assessmentId)}", "source=my-reports"]) assert(list.includes(token), `my reports behavior missing ${token}`);
assert(routes.includes("pages/my-reports/index"), "my reports route missing");
for (const token of ["historyMode", "loadHistory", "readGoalFitHistoryReportRecovery", "saveGoalFitHistoryReportRecovery", "!historyMode.value", "requested||recovery", "assessmentId.value!==requestedId", "ENTITLED_TEMPORARY_UNAVAILABLE"]) assert(detail.includes(token), `history detail behavior missing ${token}`);
assert(!detail.includes("prepareGoalFitVirtualPayment"), "history page must not directly prepare payments");
assert(detail.includes("fetchLatestGoalFitPurchase"), "existing latest recovery must remain available");
console.log("My reports M2 page and history isolation tests passed.");
