import { request } from "@/api/request";
import { getPlatform } from "@/platform";
import { readMiniappSession, saveMiniappSession } from "@/storage/miniapp-session";
import { getVisitorId } from "@/storage/visitor";

type SessionResponse = { sessionToken: string; expiresAt: string; visitorId: string };
let pending: Promise<void> | null = null;
export type MiniappSessionDeps = { platform: ReturnType<typeof getPlatform>; read: () => { sessionToken: string; expiresAt: string } | null; save: (value: { sessionToken: string; expiresAt: string }) => void; login: (callbacks: { success: (value: { code?: string }) => void; fail: () => void }) => void; exchange: (code: string, visitorId: string) => Promise<SessionResponse>; visitorId: () => string };
export function ensureWechatMiniappSessionWith(deps: MiniappSessionDeps): Promise<void> {
  let active = false; try { const session = deps.read(); active = deps.platform === "wechat_miniapp" && (!session || new Date(session.expiresAt).getTime() <= Date.now() + 60_000); } catch { return Promise.resolve(); }
  if (!active) return Promise.resolve();
  return new Promise<void>((resolve) => deps.login({ success: async ({ code }) => { try { if (!code) return; const result = await deps.exchange(code, deps.visitorId()); deps.save({ sessionToken: result.sessionToken, expiresAt: result.expiresAt }); } catch { /* identity must not block free flow */ } finally { resolve(); } }, fail: resolve }));
}
export function ensureWechatMiniappSession(): Promise<void> {
  if (getPlatform() !== "wechat_miniapp" || readMiniappSession()) return Promise.resolve();
  if (!pending) pending = ensureWechatMiniappSessionWith({ platform: getPlatform(), read: readMiniappSession, save: saveMiniappSession, login: (callbacks) => uni.login({ provider: "weixin", ...callbacks }), exchange: (code, visitorId) => request<SessionResponse, { code: string; visitorId: string }>({ path: "/api/miniapp/wechat/session", method: "POST", data: { code, visitorId } }), visitorId: getVisitorId }).finally(() => { pending = null; });
  return pending as Promise<void>;
}
