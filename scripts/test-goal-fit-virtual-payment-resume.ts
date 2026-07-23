function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
void (async () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const resume = require("../src/services/goal-fit-virtual-payment-resume") as typeof import("../src/services/goal-fit-virtual-payment-resume");
  const record={assessmentId:"asm_1",paymentAttemptId:"attempt_1",createdAt:1}; let confirms=0, reports=0, clears=0; const base={
    getPending: () => record, clearPendingIfMatches: (input:any) => { clears++; return input.assessmentId===record.assessmentId&&input.paymentAttemptId===record.paymentAttemptId; },
    confirmPayment: async () => { confirms++; return {paymentAttemptId:"attempt_1",orderId:"order",status:"paid" as const,reportAvailable:true}; }, fetchFullReport: async () => { reports++; return {full:"report"}; }, delayFn:async()=>undefined,
  };
  const none=await resume.resumeGoalFitVirtualPaymentConfirmation({assessmentId:"asm_none",dependencies:{...base,getPending:()=>null}});assert(none===null&&confirms===0&&reports===0,"no record does nothing");
  const paid=await resume.resumeGoalFitVirtualPaymentConfirmation({assessmentId:"asm_1",dependencies:base});assert(paid?.status==="paid"&&paid.report&&clears===1,"paid reads report then clears matching record");
  confirms=reports=clears=0;const pending=await resume.resumeGoalFitVirtualPaymentConfirmation({assessmentId:"asm_1",dependencies:{...base,confirmPayment:async()=>{confirms++;return {paymentAttemptId:"attempt_1",orderId:"order",status:"pending" as const,reportAvailable:false};}}});assert(pending?.status==="pending"&&clears===0&&confirms===5&&reports===0,"pending retains record after five polls");
  for(const status of ["closed","review_required"] as const){clears=0;const result=await resume.resumeGoalFitVirtualPaymentConfirmation({assessmentId:"asm_1",dependencies:{...base,confirmPayment:async()=>({paymentAttemptId:"attempt_1",orderId:"order",status,reportAvailable:false})}});assert(result?.status===status&&clears===1,`${status} clears`);}
  clears=0;const unavailable=await resume.resumeGoalFitVirtualPaymentConfirmation({assessmentId:"asm_1",dependencies:{...base,fetchFullReport:async()=>{throw new Error("temporary")}}});assert(unavailable?.safeCode==="FULL_REPORT_UNAVAILABLE"&&clears===0,"report unavailable retains record");
  console.log("Goal Fit virtual payment resume tests passed.");
})().catch((error)=>{console.error(error);process.exitCode=1;});
