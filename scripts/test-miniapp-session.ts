type Session = { sessionToken: string; expiresAt: string };
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const sensitive = ["TEST_SENSITIVE_LOGIN_CODE", "TEST_SENSITIVE_SESSION_TOKEN", "TEST_SENSITIVE_OPENID", "TEST_SENSITIVE_UNIONID"];
const originals = { log: console.log, info: console.info, warn: console.warn, error: console.error };
const originalUni = (globalThis as Record<string, unknown>).uni;
const logs: string[] = [], storage = new Map<string, unknown>(), requests: Array<Record<string, unknown>> = [];
void (async () => {
for (const name of Object.keys(originals) as Array<keyof typeof originals>) console[name] = (...args: unknown[]) => logs.push(args.map(String).join(" "));
try {
  (globalThis as Record<string, unknown>).uni = { getStorageSync: (key: string) => storage.get(key), setStorageSync: (key: string, value: unknown) => storage.set(key, value), request: (options: Record<string, unknown>) => { requests.push(options); (options.success as (value: unknown) => void)({ statusCode: 200, data: {} }); } };
  // Loaded after the uni mock: this verifies both the injected session flow and real request headers.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { ensureWechatMiniappSessionWith } = require("../src/services/miniapp-session") as typeof import("../src/services/miniapp-session");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { request, ApiError } = require("../src/api/request") as typeof import("../src/api/request");
  const future = (ms: number) => new Date(Date.now() + ms).toISOString();
  for (const platform of ["h5", "douyin_miniapp", "xiaohongshu_miniapp"] as const) { let calls = 0; await ensureWechatMiniappSessionWith({ platform, read: () => null, save: () => undefined, login: () => { calls++; }, exchange: async () => { throw new Error("unexpected"); }, visitorId: () => "visitor_12345678" }); assert(calls === 0, `${platform} must not call login`); }
  let login = 0, exchange = 0; const valid: Session = { sessionToken: "valid", expiresAt: future(61_001) };
  await ensureWechatMiniappSessionWith({ platform: "wechat_miniapp", read: () => valid, save: () => undefined, login: () => { login++; }, exchange: async () => { exchange++; return { ...valid, visitorId: "visitor_12345678" }; }, visitorId: () => "visitor_12345678" }); assert(login === 0 && exchange === 0, "valid session skips login and API");
  let saved: Session | null = null;
  await ensureWechatMiniappSessionWith({ platform: "wechat_miniapp", read: () => null, save: (value: Session) => { saved = value; }, login: ({ success }: any) => { login++; success({ code: "TEST_SENSITIVE_LOGIN_CODE" }); }, exchange: async () => ({ sessionToken: "TEST_SENSITIVE_SESSION_TOKEN", expiresAt: future(120_000), visitorId: "visitor_12345678" }), visitorId: () => "visitor_12345678" }); assert(saved?.sessionToken === "TEST_SENSITIVE_SESSION_TOKEN" && Object.keys(saved).length === 2, "only token and expiresAt persist");
  for (const expiresAt of [future(60_000), future(-1)]) { let calls = 0; await ensureWechatMiniappSessionWith({ platform: "wechat_miniapp", read: () => ({ sessionToken: "old", expiresAt }), save: () => undefined, login: ({ success }: any) => { calls++; success({ code: "new" }); }, exchange: async () => ({ sessionToken: "fresh", expiresAt: future(120_000), visitorId: "visitor_12345678" }), visitorId: () => "visitor_12345678" }); assert(calls === 1, "near/expired session relogins"); }
  for (const failing of [
    { read: () => { throw new Error("storage"); }, save: () => undefined, login: () => { throw new Error("must not login"); }, exchange: async () => { throw new Error("unexpected"); } },
    { read: () => null, save: () => { throw new Error("storage"); }, login: ({ success }: any) => success({ code: "new" }), exchange: async () => ({ sessionToken: "fresh", expiresAt: future(120_000), visitorId: "visitor_12345678" }) },
    { read: () => null, save: () => undefined, login: ({ fail }: any) => fail(), exchange: async () => { throw new Error("unexpected"); } },
    { read: () => null, save: () => undefined, login: ({ success }: any) => success({ code: "new" }), exchange: async () => { throw new Error("api"); } },
  ]) { await ensureWechatMiniappSessionWith({ platform: "wechat_miniapp", ...failing, visitorId: () => "visitor_12345678" }).then(() => { throw new Error("refresh should fail safely"); }, (error) => assert(error?.message === "MINIAPP_SESSION_REFRESH_FAILED", "refresh failures expose only a safe code")); }
  storage.set("first_job_goal_fit_miniapp_session_v1", { sessionToken: "TEST_SENSITIVE_SESSION_TOKEN", expiresAt: future(120_000) }); await request({ path: "/protected", requiresMiniappAuth: true }); assert((requests.at(-1)?.header as any).Authorization === "Bearer TEST_SENSITIVE_SESSION_TOKEN", "protected request adds bearer");
  await request({ path: "/api/pricing/goal-fit-report" }); await request({ path: "/api/analytics/visit", method: "POST", data: { visitorId: "visitor_12345678" } }); await request({ path: "/api/analytics/events", method: "POST", data: { events: [] } }); for (const item of requests.slice(-3)) assert(!(item.header as any)?.Authorization, "public requests must not authorize");
  storage.clear(); for (const session of [null, { sessionToken: "expired", expiresAt: future(-1) }]) { if (session) storage.set("first_job_goal_fit_miniapp_session_v1", session); try { await request({ path: "/protected", requiresMiniappAuth: true }); throw new Error("network sent"); } catch (error) { assert(error instanceof ApiError && error.message === "MINIAPP_AUTH_REQUIRED", "missing/expired protected request rejects locally"); } storage.clear(); }
  assert(!logs.some(line => sensitive.some(value => line.includes(value))), "console leaks sensitive value"); assert(!requests.some(item => sensitive.some(value => JSON.stringify(item.data ?? null).includes(value))), "analytics payload leaks sensitive value");
} finally { for (const name of Object.keys(originals) as Array<keyof typeof originals>) console[name] = originals[name]; if (originalUni === undefined) delete (globalThis as Record<string, unknown>).uni; else (globalThis as Record<string, unknown>).uni = originalUni; }
console.log("Miniapp session tests passed.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
