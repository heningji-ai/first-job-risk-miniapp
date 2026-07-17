import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { selectGoalFitQuestions } from "../src/domain/goal-fit/question-selector";
import { calculateGoalFitScores } from "../src/domain/goal-fit/scoring-engine";
import { buildGoalFitResult } from "../src/domain/goal-fit/result-builder";
import { projectGoalFitFreeResult } from "../src/domain/goal-fit/free-result";
import type {
  GoalFitAnswerMap,
  GoalFitQuestionBank,
  RoleType
} from "../src/domain/goal-fit/types";

const projectRoot = process.cwd();
const miniappQuestionsPath = path.join(projectRoot, "src", "config", "goal-fit", "questions.json");
const h5QuestionsPath = path.resolve(projectRoot, "..", "first-job-risk-preview", "src", "config", "goalFit", "questions.json");
const miniappBytes = fs.readFileSync(miniappQuestionsPath);
const bank = JSON.parse(miniappBytes.toString("utf8")) as GoalFitQuestionBank;
const roles: RoleType[] = ["SLS", "PM", "OPS", "TECH", "DATA", "FUNC", "MKT", "SUP"];

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[test-goal-fit-domain] ${message}`);
}

function expectThrows(label: string, fn: () => unknown): void {
  try {
    fn();
  } catch {
    return;
  }
  throw new Error(`[test-goal-fit-domain] ${label} must throw`);
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

assert(bank.questions.length === 122, "question bank must contain 122 questions");
const t01 = bank.targetQuestions.find(({ id }) => id === "T01");
const t02 = bank.targetQuestions.find(({ id }) => id === "T02");
assert(t01?.options.length === 5, "T01 must contain 5 company options");
assert(t02?.options.length === 8, "T02 must contain 8 role options");

const expectedFixedIds = [
  "A01", "A02", "A03", "A04", "A05", "A06", "A08", "A09",
  "B01", "B02", "B03", "B06", "B07", "B11",
  "C01", "C02", "C03", "C04",
  "D01", "D03", "D05", "D06", "D07", "D08", "D10", "D16"
];

for (const role of roles) {
  const selected = selectGoalFitQuestions(bank, role);
  assert(selected.length === 34, `${role} must select 34 questions`);
  assert(
    JSON.stringify(selected.slice(0, 26).map(({ id }) => id)) === JSON.stringify(expectedFixedIds),
    `${role} first 26 questions must match H5 order`
  );
  assert(
    selected.slice(26).every(({ module, roleBranch }) => module === "E_ROLE_SCENARIO" && roleBranch === role),
    `${role} last 8 questions must only use its role branch`
  );
  assert(!selected.some(({ id }) => id === "T01" || id === "T02"), `${role} must exclude T01/T02`);
}

const selected = selectGoalFitQuestions(bank, "TECH");
const answers = Object.fromEntries(
  selected.map((question, index) => [question.id, question.options[index % question.options.length].id])
) as GoalFitAnswerMap;
const score = calculateGoalFitScores({
  questionBank: bank,
  answers,
  targetCompany: "D",
  targetRole: "TECH"
});
const expectedScore = {
  companyEntryScore: 69,
  roleEntryScore: 69,
  companyPersonalityScore: 68,
  companyBehaviorScore: 66,
  companyFitScore: 69,
  rolePersonalityScore: 63,
  roleBehaviorScore: 73,
  roleFitScore: 71,
  motivationFitScore: 80,
  pairScore: 80,
  overallScore: 71,
  motivationTags: ["stable", "status"],
  riskTagCounts: [
    ["SOCIAL_DRAIN", 2], ["NEEDS_TRAINING", 2], ["MOTIVATION_MISMATCH", 2],
    ["HIGH_PRESSURE", 1], ["AMBIGUITY", 1], ["GROWTH_GAP", 1], ["LOW_CLARITY", 1]
  ],
  scoreVersion: "goal-fit-v1.3"
};

for (const [key, value] of Object.entries(expectedScore).filter(([, value]) => typeof value === "number")) {
  assert(score[key as keyof typeof score] === value, `${key} must equal H5 snapshot`);
}
assert(JSON.stringify(score.motivationTags) === JSON.stringify(expectedScore.motivationTags), "motivation tags must match H5 snapshot");
assert(
  JSON.stringify(score.riskTagCounts.map(({ tag, count }) => [tag, count])) === JSON.stringify(expectedScore.riskTagCounts),
  "risk tags must match H5 snapshot"
);
assert(JSON.stringify(score.selectedQuestionIds) === JSON.stringify(selected.map(({ id }) => id)), "selected IDs must match H5");
assert(score.scoreVersion === expectedScore.scoreVersion, "scoreVersion must match H5");
assert(
  createHash("sha256").update(JSON.stringify(score)).digest("hex") ===
    "bfac05437be486228cd953e7f27bd475ba1b53a2f744c075b07d0c26b70bf37b",
  "complete score output must match H5 snapshot"
);

const result = buildGoalFitResult({ questionBank: bank, answers, targetCompany: "D", targetRole: "TECH" });
assert(result.overallConclusion.level === "conditional_match", "conclusion level must match H5 snapshot");
assert(result.overallConclusion.title === "有潜力，但不能盲投", "conclusion title must match H5 snapshot");
assert(JSON.stringify(result.riskInsights.map(({ id }) => id)) === JSON.stringify(["platform_halo_pressure"]), "risk order must match H5 snapshot");
assert(
  JSON.stringify(result.recommendations.map(({ title }) => title)) ===
    JSON.stringify(["面试时确认带教机制", "确认真实工作强度"]),
  "recommendations must match H5 snapshot"
);
assert(result.resultVersion === "goal-fit-result-v1.3", "resultVersion must match H5");
assert(
  createHash("sha256")
    .update(JSON.stringify({
      overallConclusion: result.overallConclusion,
      riskInsights: result.riskInsights,
      recommendations: result.recommendations,
      resultVersion: result.resultVersion
    }))
    .digest("hex") === "7b399d44d6e9a1a8cb3509ab7979907187d32e273a1ad4e2afa65c0ca6685e33",
  "conclusion, risks, recommendations and resultVersion must match H5 snapshot"
);

const freeResult = projectGoalFitFreeResult(result);
assert(Object.keys(freeResult).sort().join(",") === "actionReminder,overallConclusion,overallScore,primaryRisk,riskPoints", "free result fields must remain limited");

const missing = { ...answers };
delete missing.TECH01;
expectThrows("missing answer", () => calculateGoalFitScores({ questionBank: bank, answers: missing, targetCompany: "D", targetRole: "TECH" }));
expectThrows("invalid option", () => calculateGoalFitScores({ questionBank: bank, answers: { ...answers, TECH01: "invalid_option" }, targetCompany: "D", targetRole: "TECH" }));
const invalidBank = JSON.parse(JSON.stringify(bank)) as GoalFitQuestionBank;
invalidBank.questions = invalidBank.questions.filter(({ id }) => id !== "A01");
expectThrows("missing question", () => selectGoalFitQuestions(invalidBank, "TECH"));

if (fs.existsSync(h5QuestionsPath)) {
  const h5Bytes = fs.readFileSync(h5QuestionsPath);
  assert(Buffer.compare(miniappBytes, h5Bytes) === 0, "miniapp and H5 questions.json must be byte-identical");
  console.log(`questions.json SHA-256: ${sha256(miniappBytes)}`);
} else {
  console.warn(`H5 questions.json not found; miniapp SHA-256: ${sha256(miniappBytes)}`);
}

console.log("Goal Fit domain equivalence tests passed.");
