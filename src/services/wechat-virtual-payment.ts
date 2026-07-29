const MINIMUM_SDK_VERSION = [2, 19, 2] as const;
export const WECHAT_VIRTUAL_PAYMENT_TIMEOUT_MS = 20_000;

export interface WechatVirtualPaymentInvocationParams {
  mode: "short_series_goods";
  signData: string;
  paySig: string;
  signature: string;
}

export interface WechatVirtualPaymentInvocationResult {
  status: "invoked";
}

export type WechatVirtualPaymentFailureKind =
  | "cancelled"
  | "uncertain"
  | "session_key_expired"
  | "rate_limited"
  | "configuration_error"
  | "risk_blocked"
  | "failed"
  | "unsupported"
  | "invalid_params"
  | "timeout";

const SAFE_CODES: Record<WechatVirtualPaymentFailureKind, string> = {
  cancelled: "WECHAT_VIRTUAL_PAYMENT_CANCELLED",
  uncertain: "WECHAT_VIRTUAL_PAYMENT_UNCERTAIN",
  session_key_expired: "WECHAT_VIRTUAL_PAYMENT_SESSION_KEY_EXPIRED",
  rate_limited: "WECHAT_VIRTUAL_PAYMENT_RATE_LIMITED",
  configuration_error: "WECHAT_VIRTUAL_PAYMENT_CONFIGURATION_ERROR",
  risk_blocked: "WECHAT_VIRTUAL_PAYMENT_RISK_BLOCKED",
  failed: "WECHAT_VIRTUAL_PAYMENT_FAILED",
  unsupported: "WECHAT_VIRTUAL_PAYMENT_UNSUPPORTED",
  invalid_params: "WECHAT_VIRTUAL_PAYMENT_INVALID_PARAMS",
  timeout: "WECHAT_VIRTUAL_PAYMENT_TIMEOUT",
};

export class WechatVirtualPaymentError extends Error {
  readonly kind: WechatVirtualPaymentFailureKind;
  readonly safeCode: string;
  readonly providerCode?: number;

  constructor(kind: WechatVirtualPaymentFailureKind, providerCode?: number) {
    super(SAFE_CODES[kind]);
    this.name = "WechatVirtualPaymentError";
    this.kind = kind;
    this.safeCode = SAFE_CODES[kind];
    if (typeof providerCode === "number") this.providerCode = providerCode;
  }
}

type WxApi = {
  getSystemInfoSync?: () => { SDKVersion?: unknown; platform?: unknown; version?: unknown };
  canIUse?: (name: string) => boolean;
  login?: (options: { success: (result: { code?: unknown }) => void; fail: () => void }) => void;
  requestVirtualPayment?: (options: WechatVirtualPaymentInvocationParams & { success: (result: unknown) => void; fail: (error: unknown) => void; complete: (result: unknown) => void }) => void;
};

function getWx(): WxApi | null {
  const value = (globalThis as { wx?: unknown }).wx;
  return value && typeof value === "object" ? value as WxApi : null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseVersion(value: unknown): number[] | null {
  if (!isNonEmptyString(value) || !/^\d+(?:\.\d+){0,2}$/.test(value)) return null;
  return value.split(".").map((part) => Number(part));
}

function isAtLeastMinimumVersion(value: unknown): boolean {
  const parts = parseVersion(value);
  if (!parts) return false;
  for (let index = 0; index < MINIMUM_SDK_VERSION.length; index += 1) {
    const actual = parts[index] ?? 0;
    const required = MINIMUM_SDK_VERSION[index];
    if (actual !== required) return actual > required;
  }
  return true;
}

export function isWechatVirtualPaymentSupported(): boolean {
  const wxApi = getWx();
  if (!wxApi || typeof wxApi.requestVirtualPayment !== "function") return false;
  try {
    if (isAtLeastMinimumVersion(wxApi.getSystemInfoSync?.().SDKVersion)) return true;
  } catch {
    // Fall through to canIUse.
  }
  try {
    return wxApi.canIUse?.("requestVirtualPayment") === true;
  } catch {
    return false;
  }
}

export function classifyWechatVirtualPaymentFailure(error: unknown): WechatVirtualPaymentError {
  const providerCode = typeof (error as { errCode?: unknown })?.errCode === "number"
    ? (error as { errCode: number }).errCode
    : undefined;
  const kind: WechatVirtualPaymentFailureKind = providerCode === -2 ? "cancelled"
    : providerCode === -1 || providerCode === -15003 || providerCode === -15012 ? "uncertain"
    : providerCode === -15007 ? "session_key_expired"
    : providerCode === -15020 || providerCode === -15021 ? "rate_limited"
    : providerCode === 1001 || [-15001, -15002, -15004, -15005, -15006, -15008, -15009, -15010, -15011, -15013, -15014, -15016, -15018].includes(providerCode ?? Number.NaN) ? "configuration_error"
    : providerCode === -4 || providerCode === -15017 || providerCode === -15019 ? "risk_blocked"
    : "failed";
  return new WechatVirtualPaymentError(kind, providerCode);
}

function reportVirtualPaymentDiagnostic(event: string, extra: Record<string, string | number | undefined> = {}): void {
  const details: Record<string, string | number> = {};
  try {
    const info = getWx()?.getSystemInfoSync?.();
    if (typeof info?.platform === "string") details.platform = info.platform;
    if (typeof info?.version === "string") details.wechatVersion = info.version;
    if (typeof info?.SDKVersion === "string") details.sdkVersion = info.SDKVersion;
  } catch { /* diagnostics cannot affect payment */ }
  for (const [key, value] of Object.entries(extra)) if (value !== undefined) details[key] = value;
  try { console.info("[goal-fit-payment]", event, details); } catch { /* console availability cannot affect payment */ }
}

export function requestWechatLoginCode(): Promise<string> {
  const login = getWx()?.login;
  if (typeof login !== "function") return Promise.reject(new WechatVirtualPaymentError("unsupported"));
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = () => { if (!settled) { settled = true; reject(new WechatVirtualPaymentError("failed")); } };
    try {
      login({
        success: (result) => {
          if (settled) return;
          settled = true;
          if (isNonEmptyString(result?.code)) resolve(result.code);
          else reject(new WechatVirtualPaymentError("failed"));
        },
        fail,
      });
    } catch {
      fail();
    }
  });
}

function validInvocationParams(value: WechatVirtualPaymentInvocationParams): boolean {
  return value.mode === "short_series_goods" && isNonEmptyString(value.signData) && isNonEmptyString(value.paySig) && isNonEmptyString(value.signature);
}

export function invokeWechatVirtualPayment(
  params: WechatVirtualPaymentInvocationParams,
  options: { timeoutMs?: number } = {},
): Promise<WechatVirtualPaymentInvocationResult> {
  if (!validInvocationParams(params)) return Promise.reject(new WechatVirtualPaymentError("invalid_params"));
  if (!isWechatVirtualPaymentSupported()) return Promise.reject(new WechatVirtualPaymentError("unsupported"));
  const invoke = getWx()?.requestVirtualPayment;
  if (typeof invoke !== "function") return Promise.reject(new WechatVirtualPaymentError("unsupported"));
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeoutMs = typeof options.timeoutMs === "number" && Number.isFinite(options.timeoutMs) && options.timeoutMs >= 0
      ? options.timeoutMs
      : WECHAT_VIRTUAL_PAYMENT_TIMEOUT_MS;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      reportVirtualPaymentDiagnostic("virtual_payment_timeout");
      reject(new WechatVirtualPaymentError("timeout"));
    }, timeoutMs);
    const succeed = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reportVirtualPaymentDiagnostic("virtual_payment_success");
      resolve({ status: "invoked" });
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      const providerCode = typeof (error as { errCode?: unknown })?.errCode === "number" ? (error as { errCode: number }).errCode : undefined;
      reportVirtualPaymentDiagnostic("virtual_payment_fail", { errCode: providerCode });
      reject(classifyWechatVirtualPaymentFailure(error));
    };
    try {
      reportVirtualPaymentDiagnostic("virtual_payment_invoking");
      invoke({
        mode: params.mode,
        signData: params.signData,
        paySig: params.paySig,
        signature: params.signature,
        success: succeed,
        fail,
        complete: () => { reportVirtualPaymentDiagnostic("virtual_payment_complete"); },
      });
    } catch {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reportVirtualPaymentDiagnostic("virtual_payment_sync_throw");
        reject(new WechatVirtualPaymentError("failed"));
      }
    }
  });
}
