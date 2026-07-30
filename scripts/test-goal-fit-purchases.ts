const fs = require("node:fs");

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

const api = fs.readFileSync("src/api/goal-fit-payment.ts", "utf8");
const types = fs.readFileSync("src/types/goal-fit-report-conversion.ts", "utf8");

for (const token of [
  "fetchGoalFitPurchases",
  'path: "/api/miniapp/goal-fit/purchases"',
  "requiresMiniappAuth: true",
  "GoalFitPurchaseListItem",
  "GoalFitPurchaseListResponse",
  "isOfficialAssessmentId",
  "/^asm_[A-Za-z0-9_-]{8,}$/",
  "purchases.every(isPurchaseListItem)",
  "GoalFitPurchasesContractError",
  "purchases_array",
  "purchase_item",
  '"REFUNDED"',
  "item.unlocked === false",
  "revokedAt",
]) assert(api.includes(token) || types.includes(token), `missing purchases contract: ${token}`);
assert(!api.includes("assessment_"), "local assessment IDs must not be accepted by purchases parsing");
console.log("Goal Fit purchases API contract tests passed.");
