function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
async function rejected(action: () => Promise<unknown>, kind: string): Promise<void> { try { await action(); } catch (error) { assert((error as { kind?: string }).kind === kind, `expected ${kind}`); return; } throw new Error(`expected ${kind}`); }
const source = require("node:fs").readFileSync("src/services/wechat-virtual-payment.ts", "utf8");
assert(!source.includes('import("@/analytics")') && source.includes("setWechatVirtualPaymentDiagnosticReporter"), "payment diagnostics must use the page-injected reporter instead of dynamic analytics loading");
const originalWx = (globalThis as { wx?: unknown }).wx;
const originalConsoleInfo = console.info;
const originalConsoleWarn = console.warn;
void (async () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const payment = require("../src/services/wechat-virtual-payment") as typeof import("../src/services/wechat-virtual-payment");
  const setWx = (value: unknown) => { (globalThis as { wx?: unknown }).wx = value; };
  const supported = (SDKVersion: string, canIUse = false) => ({ getSystemInfoSync: () => ({ SDKVersion }), canIUse: () => canIUse, requestVirtualPayment: () => undefined });
  const logs: unknown[][] = [];
  const warnings: unknown[][] = [];
  const analyticsEvents: Array<{ name: string; metadata: Record<string, unknown> }> = [];
  console.info = (...values: unknown[]) => { logs.push(values); };
  console.warn = (...values: unknown[]) => { warnings.push(values); };
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
    setWx({ getSystemInfoSync: () => ({ SDKVersion: "2.19.2", platform: "ios", version: "8.0.0" }), requestVirtualPayment: (options: any) => { captured = options; callbacks = options; options.success({ errCode: 0, errno: 0, errMsg: "ok" }); options.complete({ errCode: 0, errno: 0, errMsg: "ok" }); options.fail({ errCode: -2, errno: -2, errMsg: "hidden" }); } });
    const params = { mode: "short_series_goods" as const, signData: "TEST_SIGN_DATA_SECRET", paySig: "TEST_PAY_SIG_SECRET", signature: "TEST_SIGNATURE_SECRET" };
    const diagnosticContext = { assessmentIdSuffix: "test01", paymentAttemptIdSuffix: "pt0001", requestIdSuffix: "rq0001" };
    const result = await payment.invokeWechatVirtualPayment(params, { diagnosticContext }); assert(result.status === "invoked" && !("paid" in result), "success only means invoked");
    assert(captured && JSON.stringify(Object.keys(captured).sort()) === JSON.stringify(["complete", "fail", "mode", "paySig", "signData", "signature", "success"]), "exact wx params"); assert((captured as any).signData === params.signData, "signData unchanged");
    for (const bad of [{ ...params, mode: "wrong" }, { ...params, signData: "" }, { ...params, paySig: "" }, { ...params, signature: "" }] as any[]) await rejected(() => payment.invokeWechatVirtualPayment(bad), "invalid_params");
    const cases: Array<[number | undefined, string]> = [[-2,"cancelled"],[-1,"uncertain"],[-15003,"uncertain"],[-15012,"uncertain"],[-15007,"session_key_expired"],[-15020,"rate_limited"],[-15021,"rate_limited"],[1001,"configuration_error"],[-15001,"configuration_error"],[-4,"risk_blocked"],[-15017,"risk_blocked"],[999,"failed"],[undefined,"failed"]];
    for (const [errCode, kind] of cases) { setWx({ getSystemInfoSync: () => ({ SDKVersion: "2.19.2" }), requestVirtualPayment: ({ fail }: any) => fail(errCode === undefined ? {} : { errCode, errMsg: "TEST_SECRET" }) }); await rejected(() => payment.invokeWechatVirtualPayment(params), kind); }
    const safeError = payment.classifyWechatVirtualPaymentFailure({ errCode: -2, errMsg: "TEST_SECRET" });
    assert(!JSON.stringify(safeError).includes("TEST_SECRET") && !safeError.message.includes("TEST_SECRET"), "payment errors must not expose provider errMsg");
    setWx({ getSystemInfoSync: () => ({ SDKVersion: "2.19.2" }), requestVirtualPayment: ({ fail }: any) => fail({ errCode: -15001, errMsg: "missing parameter: offerId signData=TEST_SIGN_DATA_SECRET" }) });
    await rejected(() => payment.invokeWechatVirtualPayment(params, { diagnosticContext }), "configuration_error");
    const providerFailure = [...analyticsEvents].reverse().find((event) => event.name === "virtual_payment_fail");
    assert(providerFailure?.metadata.providerErrorDetail === "missing parameter, offerId" && !JSON.stringify(providerFailure).includes("TEST_SIGN_DATA_SECRET"), "fail diagnostics must upload only the sanitized provider detail");
    let invoked = false; setWx(undefined); await rejected(() => payment.invokeWechatVirtualPayment(params), "unsupported"); assert(!invoked, "unsupported must not invoke");
    setWx({ getSystemInfoSync: () => ({ SDKVersion: "2.19.2" }), requestVirtualPayment: () => { invoked = true; throw new Error("TEST_SECRET"); } }); await rejected(() => payment.invokeWechatVirtualPayment(params), "failed"); assert(invoked, "sync throw classified");
    setWx({ getSystemInfoSync: () => ({ SDKVersion: "2.19.2" }), requestVirtualPayment: () => undefined }); await rejected(() => payment.invokeWechatVirtualPayment(params, { timeoutMs: 0, diagnosticContext }), "timeout");
    assert(logs.some((items) => items.includes("virtual_payment_success")) && logs.some((items) => items.includes("virtual_payment_complete")) && logs.some((items) => items.includes("virtual_payment_sync_throw")) && logs.some((items) => items.includes("virtual_payment_timeout")), "safe diagnostics must cover callback, throw, and timeout paths");
    assert(!JSON.stringify(logs).includes(params.signData) && !JSON.stringify(logs).includes(params.paySig) && !JSON.stringify(logs).includes(params.signature) && !JSON.stringify(logs).includes("TEST_SECRET"), "payment diagnostics must not expose payment parameters or provider details");
    assert(payment.providerErrorDetail("requestVirtualPayment:fail missing parameter: offerId signData=TEST_SIGN_DATA_SECRET outTradeNo=12345678901234567890 https://example.test?a=TEST_SECRET") === "missing parameter, offerId, outTradeNo", "provider error detail must keep only safe, actionable keywords");
    assert(payment.providerErrorDetail("openid=TEST_OPENID_SECRET session_key=TEST_SESSION_SECRET ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890") === undefined, "sensitive provider error text must not be uploaded");
    const successEvent = analyticsEvents.find((event) => event.name === "virtual_payment_success");
    const completeEvent = analyticsEvents.find((event) => event.name === "virtual_payment_complete");
    assert(successEvent?.metadata.callbackPhase === "success" && successEvent.metadata.errCode === 0 && successEvent.metadata.errno === 0, "success callback diagnostics must retain only safe callback fields");
    assert(completeEvent?.metadata.callbackPhase === "complete" && completeEvent.metadata.errCode === 0 && completeEvent.metadata.errno === 0, "complete callback diagnostics must retain only safe callback fields");
    const allowedMetadata = new Set(["platform", "wechatVersion", "sdkVersion", "assessmentIdSuffix", "paymentAttemptIdSuffix", "requestIdSuffix", "callbackPhase", "callbackAt", "errCode", "errno", "errorCode", "errorMessageCategory", "providerErrorDetail", "modePresent", "signDataType", "signDataLength", "paySigType", "paySigLength", "signatureType", "signatureLength", "hasNullOrUndefinedPaymentParameter"]);
    assert(analyticsEvents.some((event) => event.name === "virtual_payment_invoking") && analyticsEvents.some((event) => event.name === "virtual_payment_success") && analyticsEvents.some((event) => event.name === "virtual_payment_fail") && analyticsEvents.some((event) => event.name === "virtual_payment_complete") && analyticsEvents.some((event) => event.name === "virtual_payment_sync_throw") && analyticsEvents.some((event) => event.name === "virtual_payment_timeout"), "safe virtual-payment diagnostics must reach analytics");
    for (const event of analyticsEvents) for (const key of Object.keys(event.metadata)) assert(allowedMetadata.has(key), `unexpected analytics metadata key ${key}`);
    assert(!JSON.stringify(analyticsEvents).includes(params.signData) && !JSON.stringify(analyticsEvents).includes(params.paySig) && !JSON.stringify(analyticsEvents).includes(params.signature) && !JSON.stringify(analyticsEvents).includes("TEST_SECRET"), "analytics diagnostics must not expose payment parameters or provider details");
    payment.setWechatVirtualPaymentDiagnosticTrackerForTest(async () => { throw new Error("TEST_SECRET"); });
    setWx({ getSystemInfoSync: () => ({ SDKVersion: "2.19.2" }), requestVirtualPayment: ({ success }: any) => success({}) });
    await payment.invokeWechatVirtualPayment(params, { diagnosticContext });
    await Promise.resolve();
    assert(warnings.some((items) => JSON.stringify(items).includes("ANALYTICS_UPLOAD_FAILED")) && !JSON.stringify(warnings).includes("TEST_SECRET") && !JSON.stringify(warnings).includes(params.signData), "analytics failure must warn safely without affecting payment");
    assert(callbacks, "callbacks captured");
  } finally { payment.setWechatVirtualPaymentDiagnosticTrackerForTest(); console.info = originalConsoleInfo; console.warn = originalConsoleWarn; if (originalWx === undefined) delete (globalThis as { wx?: unknown }).wx; else (globalThis as { wx?: unknown }).wx = originalWx; }
  console.log("Wechat virtual payment tests passed.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
