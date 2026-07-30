import { request } from "@/api/request";
import { getPlatform } from "@/platform";
import { clearMiniappSession, readMiniappSession, readStoredMiniappSession, saveMiniappSession } from "@/storage/miniapp-session";
import { getVisitorId } from "@/storage/visitor";

type SessionResponse = { sessionToken: string; expiresAt: string; visitorId: string };
const SESSION_REFRESH_WINDOW_MS = 60_000;
export type MiniappSessionAction = "reuse" | "proactive_refresh" | "forced_refresh";
export type MiniappSessionRefreshReason = "missing" | "expired" | "near_expiry" | "provider_401";
export class MiniappSessionRefreshError extends Error { constructor(readonly reason: MiniappSessionRefreshReason) { super("MINIAPP_SESSION_REFRESH_FAILED"); this.name = "MiniappSessionRefreshError"; } }
let pending: Promise<MiniappSessionAction> | null = null;
export type MiniappSessionDeps = { platform: ReturnType<typeof getPlatform>; read: () => { sessionToken: string; expiresAt: string } | null; save: (value: { sessionToken: string; expiresAt: string }) => void; login: (callbacks: { success: (value: { code?: string }) => void; fail: () => void }) => void; exchange: (code: string, visitorId: string) => Promise<SessionResponse>; visitorId: () => string };
function refreshReason(session: { sessionToken: string; expiresAt: string } | null, force: boolean): MiniappSessionRefreshReason | null {
  if (force) return "provider_401";
  if (!session) return "missing";
  const expiresAt = new Date(session.expiresAt).getTime();
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return "expired";
  return expiresAt <= Date.now() + SESSION_REFRESH_WINDOW_MS ? "near_expiry" : null;
}
export function ensureWechatMiniappSessionWith(deps: MiniappSessionDeps): Promise<MiniappSessionAction> {
  if (deps.platform !== "wechat_miniapp") return Promise.resolve("reuse");
  let session: { sessionToken: string; expiresAt: string } | null;
  try { session = deps.read(); } catch { return Promise.reject(new MiniappSessionRefreshError("missing")); }
  const reason = refreshReason(session, false);
  if (!reason) return Promise.resolve("reuse");
  return new Promise<MiniappSessionAction>((resolve, reject) => deps.login({ success: async ({ code }) => { try { if (!code) throw new MiniappSessionRefreshError(reason); const result = await deps.exchange(code, deps.visitorId()); if (!result?.sessionToken || !result.expiresAt) throw new MiniappSessionRefreshError(reason); deps.save({ sessionToken: result.sessionToken, expiresAt: result.expiresAt }); resolve("proactive_refresh"); } catch { reject(new MiniappSessionRefreshError(reason)); } }, fail: () => reject(new MiniappSessionRefreshError(reason)) }));
}
function refresh(force: boolean): Promise<MiniappSessionAction> {
  if (getPlatform() !== "wechat_miniapp") return Promise.resolve("reuse");
  const reason = refreshReason(readStoredMiniappSession(), force);
  if (!reason) return Promise.resolve("reuse");
  if (!pending) {
    clearMiniappSession();
    pending = ensureWechatMiniappSessionWith({ platform: getPlatform(), read: () => null, save: saveMiniappSession, login: (callbacks) => uni.login({ provider: "weixin", ...callbacks }), exchange: (code, visitorId) => request<SessionResponse, { code: string; visitorId: string }>({ path: "/api/miniapp/wechat/session", method: "POST", data: { code, visitorId } }), visitorId: getVisitorId })
      .then(() => force ? "forced_refresh" : "proactive_refresh")
      .finally(() => { pending = null; });
  }
  return pending;
}
export function ensureWechatMiniappSession(): Promise<void> { return refresh(false).then(() => undefined); }
export function forceRefreshWechatMiniappSession(): Promise<void> { return refresh(true).then(() => undefined); }
