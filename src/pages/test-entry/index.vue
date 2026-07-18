<script setup lang="ts">
import { onLoad, onShow } from "@dcloudio/uni-app";
import { computed, ref } from "vue";
import { trackEvent } from "@/analytics";
import { goalFitQuestionBank } from "@/domain/goal-fit/question-bank";
import type { CompanyType, RoleType } from "@/domain/goal-fit/types";
import { clearAssessmentDraft, createAssessmentDraft, createNewTargetSelectionState, hasStartedAnswering, readAssessmentDraft, saveAssessmentDraft } from "@/storage/assessment";

const step = ref<"company" | "role" | "confirm">("company");
const company = ref<CompanyType | null>(null); const role = ref<RoleType | null>(null);
const draft = ref(readAssessmentDraft());
const companyQuestion = goalFitQuestionBank.targetQuestions.find((item) => item.id === "T01")!;
const roleQuestion = goalFitQuestionBank.targetQuestions.find((item) => item.id === "T02")!;
const hasDraft = computed(() => hasStartedAnswering(draft.value));

onLoad((query) => { void trackEvent("miniapp_test_entry_view", { metadata: { resumed: hasDraft.value } }); });
onShow(() => { draft.value = readAssessmentDraft(); });
function chooseCompany(value: string): void { company.value = value as CompanyType; step.value = "role"; void trackEvent("goal_company_selected", { metadata: { targetCompany: value } }); }
function chooseRole(value: string): void { role.value = value as RoleType; step.value = "confirm"; void trackEvent("goal_role_selected", { metadata: { targetCompany: company.value, targetRole: value } }); }
function start(): void {
  if (!company.value || !role.value) return;
  const next = createAssessmentDraft(company.value, role.value);
  if (!saveAssessmentDraft(next)) { uni.showToast({ title: "保存测试失败，请重试", icon: "none" }); return; }
  void trackEvent("test_form_start", { metadata: { targetCompany: company.value, targetRole: role.value, questionCount: 34 } });
  uni.navigateTo({ url: "/pages/assessment/index" });
}
function resume(): void { uni.navigateTo({ url: "/pages/assessment/index" }); }
function restart(): void { uni.showModal({ title: "重新开始并更换目标", content: "当前公司、岗位和全部作答将被清空，是否继续？", success: ({ confirm }) => { if (!confirm) return; clearAssessmentDraft(); const reset = createNewTargetSelectionState(); draft.value = null; step.value = reset.step; company.value = reset.targetCompany; role.value = reset.targetRole; } }); }
</script>
<template><view class="page"><view v-if="hasDraft" class="card"><text class="title">继续上次测试</text><text class="choice">公司：{{ goalFitQuestionBank.companyTypes[draft!.targetCompany!] }}</text><text class="choice">岗位：{{ goalFitQuestionBank.roleTypes[draft!.targetRole!] }}</text><text class="muted">已回答 {{ Object.keys(draft!.answers).length }}/34 题</text><button class="primary" @click="resume">继续测试</button><button @click="restart">重新开始并更换目标</button></view><view v-else class="card"><text class="title">{{ step === 'company' ? companyQuestion.text : step === 'role' ? roleQuestion.text : '确认你的目标' }}</text><view v-if="step === 'company'" class="options"><button v-for="item in companyQuestion.options" :key="item.id" @click="chooseCompany(item.id)">{{ item.text }}</button></view><view v-else-if="step === 'role'" class="options"><button v-for="item in roleQuestion.options" :key="item.id" @click="chooseRole(item.id)">{{ item.text }}</button></view><view v-else><text class="choice">公司：{{ goalFitQuestionBank.companyTypes[company!] }}</text><text class="choice">岗位：{{ goalFitQuestionBank.roleTypes[role!] }}</text><button class="primary" @click="start">开始 34 题测试</button><button @click="step = 'role'">返回修改</button></view></view></view></template>
<style scoped>.page{min-height:100vh;padding:48rpx 32rpx;box-sizing:border-box}.card{background:#fff;border-radius:24rpx;padding:36rpx}.title,.muted,.choice{display:block}.title{font-size:40rpx;font-weight:700;margin-bottom:28rpx}.muted{color:#667085;margin-bottom:24rpx}.choice{font-size:30rpx;margin:20rpx 0}.options button,button{margin:20rpx 0;text-align:left}.primary{background:#4057d6;color:#fff;text-align:center}</style>
