function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
async function rejected(action: () => Promise<unknown>, kind: string): Promise<void> { try { await action(); } catch (error) { assert((error as { kind?: string }).kind === kind, `expected ${kind}`); return; } throw new Error(`expected ${kind}`); }
const originalWx = (globalThis as { wx?: unknown }).wx;
const originalConsoleInfo = console.info;
void (async () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const payment = require("../src/services/wechat-virtual-payment") as typeof import("../src/services/wechat-virtual-payment");
  const setWx = (value: unknown) => { (globalThis as { wx?: unknown }).wx = value; };
  const supported = (SDKVersion: string, canIUse = false) => ({ getSystemInfoSync: () => ({ SDKVersion }), canIUse: () => canIUse, requestVirtualPayment: () => undefined });
  const logs: unknown[][] = [];
  const analyticsEvents: Array<{ name: string; metadata: Record<string, unknown> }> = [];
  console.info = (...values: unknown[]) => { logs.push(values); };
  payment.setWechatVirtualPaymentDiagnosticTrackerForTest(async (name, options) => { analyticsEvents.push({ name, metadata: options.metadata ?? {} }); });
  try {
    for (const [version, expected] of [["2.19.2", true], ["2.19.1", false], ["2.20.0", true], ["3.0.0", true], ["2.9.10", false]] as const) { setWx(supported(version)); assert(payment.isWechatVirtualPaymentSupported() === expected, `SDK ${version}`); }
    setWx({ getSystemInfoSync: () => ({ SDKVersion: "" }), canIUse: () => true, requestVirtualPayment: () => undefined }); assert(payment.isWechatVirtualPaymentSupported(), "canIUse fallback");
    setWx({ getSystemInfoSync: () => { throw new Error("errMsg hidden"); }, canIUse: () => true, requestVirtualPayment: () => undefined }); assert(payment.isWechatVirtualPaymentSupported(), "throw fallback");
    setWx({ getSystemInfoSync: () => ({ SDKVersion: "2.19.1" }), canIUse: () => { throw new Error("errMsg hidden"); }, requestVirtualPayment: () => undefined }); assert(!payment.isWechatVirtualPaymentSupported(), "canIUse throw safe");
    setWx(undefined); assert(!payment.isWechatVirtualPaymentSupported(), "no wx unsupported");

    setWx({ login: ({ success }: any) => success({ code: "one-time-code" }) }); assert(await payment.requestWechatLoginCode() === "one-time-code", "login code");
    setWx({ login: ({ success }: any) => success({ code: "" }) }); await rejected(payment.requestWechatLoginCode, "failed");
    setWx({ login: ({ fail }: any) => fail() }); await rejected(payment.requestWechatLoginCode, "failed");
    setWx({ login: () => { throw new Error("errMsg one-time-code"); } }); await rejected(payment.requestWechatLoginCode, "failed");
    setWx(undefined); await rejected(payment.requestWechatLoginCode, "unsupported");

    let captured: Record<string, unknown> | null = null; let callbacks: any;
    setWx({ getSystemInfoSync: () => ({ SDKVersion: "2.19.2", platform: "ios", version: "8.0.0" }), requestVirtualPayment: (options: any) => { captured = options; callbacks = options; options.success({}); options.complete({}); options.fail({ errCode: -2, errMsg: "hidden" }); } });
    const params = { mode: "short_series_goods" as const, signData: "TEST_SIGN_DATA_SECRET", paySig: "TEST_PAY_SIG_SECRET", signature: "TEST_SIGNATURE_SECRET" };
    const diagnosticContext = { assessmentIdSuffix: "test01", paymentAttemptIdSuffix: "pt0001", requestIdSuffix: "rq0001" };
    const result = await payment.invokeWechatVirtualPayment(params, { diagnosticContext }); assert(result.status === "invoked" && !("paid" in result), "success only means invoked");
    assert(captured && JSON.stringify(Object.keys(captured).sort()) === JSON.stringify(["complete", "fail", "mode", "paySig", "signData", "signature", "success"]), "exact wx params"); assert((captured as any).signData === params.signData, "signData unchanged");
    for (const bad of [{ ...params, mode: "wrong" }, { ...params, signData: "" }, { ...params, paySig: "" }, { ...params, signature: "" }] as any[]) await rejected(() => payment.invokeWechatVirtualPayment(bad), "invalid_params");
    const cases: Array<[number | undefined, string]> = [[-2,"cancelled"],[-1,"uncertain"],[-15003,"uncertain"],[-15012,"uncertain"],[-15007,"session_key_expired"],[-15020,"rate_limited"],[-15021,"rate_limited"],[1001,"configuration_error"],[-15001,"configuration_error"],[-4,"risk_blocked"],[-15017,"risk_blocked"],[999,"failed"],[undefined,"failed"]];
    for (const [errCode, kind] of cases) { setWx({ getSystemInfoSync: () => ({ SDKVersion: "2.19.2" }), requestVirtualPayment: ({ fail }: any) => fail(errCode === undefined ? {} : { errCode, errMsg: "TEST_SECRET" }) }); await rejected(() => payment.invokeWechatVirtualPayment(params), kind); }
    const safeError = payment.classifyWechatVirtualPaymentFailure({ errCode: -2, errMsg: "TEST_SECRET" });
    assert(!JSON.stringify(safeError).includes("TEST_SECRET") && !safeError.message.includes("TEST_SECRET"), "payment errors must not expose provider errMsg");
    let invoked = false; setWx(undefined); await rejected(() => payment.invokeWechatVirtualPayment(params), "unsupported"); assert(!invoked, "unsupported must not invoke");
    setWx({ getSystemInfoSync: () => ({ SDKVersion: "2.19.2" }), requestVirtualPayment: () => { invoked = true; throw new Error("TEST_SECRET"); } }); await rejected(() => payment.invokeWechatVirtualPayment(params), "failed"); assert(invoked, "sync throw classified");
    setWx({ getSystemInfoSync: () => ({ SDKVersion: "2.19.2" }), requestVirtualPayment: () => undefined }); await rejected(() => payment.invokeWechatVirtualPayment(params, { timeoutMs: 0, diagnosticContext }), "timeout");
    assert(logs.some((items) => items.includes("virtual_payment_success")) && logs.some((items) => items.includes("virtual_payment_complete")) && logs.some((items) => items.includes("virtual_payment_sync_throw")) && logs.some((items) => items.includes("virtual_payment_timeout")), "safe diagnostics must cover callback, throw, and timeout paths");
    assert(!JSON.stringify(logs).includes(params.signData) && !JSON.stringify(logs).includes(params.paySig) && !JSON.stringify(logs).includes(params.signature) && !JSON.stringify(logs).includes("TEST_SECRET"), "payment diagnostics must not expose payment parameters or provider details");
    const allowedMetadata = new Set(["platform", "wechatVersion", "sdkVersion", "assessmentIdSuffix", "paymentAttemptIdSuffix", "requestIdSuffix", "errorCode", "errorMessageCategory", "modePresent", "signDataType", "signDataLength", "paySigType", "paySigLength", "signatureType", "signatureLength", "hasNullOrUndefinedPaymentParameter"]);
    assert(analyticsEvents.some((event) => event.name === "virtual_payment_invoking") && analyticsEvents.some((event) => event.name === "virtual_payment_success") && analyticsEvents.some((event) => event.name === "virtual_payment_fail") && analyticsEvents.some((event) => event.name === "virtual_payment_complete") && analyticsEvents.some((event) => event.name === "virtual_payment_sync_throw") && analyticsEvents.some((event) => event.name === "virtual_payment_timeout"), "safe virtual-payment diagnostics must reach analytics");
    for (const event of analyticsEvents) for (const key of Object.keys(event.metadata)) assert(allowedMetadata.has(key), `unexpected analytics metadata key ${key}`);
    assert(!JSON.stringify(analyticsEvents).includes(params.signData) && !JSON.stringify(analyticsEvents).includes(params.paySig) && !JSON.stringify(analyticsEvents).includes(params.signature) && !JSON.stringify(analyticsEvents).includes("TEST_SECRET"), "analytics diagnostics must not expose payment parameters or provider details");
    assert(callbacks, "callbacks captured");
  } finally { payment.setWechatVirtualPaymentDiagnosticTrackerForTest(); console.info = originalConsoleInfo; if (originalWx === undefined) delete (globalThis as { wx?: unknown }).wx; else (globalThis as { wx?: unknown }).wx = originalWx; }
  console.log("Wechat virtual payment tests passed.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
