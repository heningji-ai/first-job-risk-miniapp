const KEY = "first_job_goal_fit_miniapp_session_v1";
export type MiniappSession = { sessionToken: string; expiresAt: string };
export function readMiniappSession(): MiniappSession | null { try { const value = uni.getStorageSync(KEY) as MiniappSession; return value?.sessionToken && new Date(value.expiresAt).getTime() > Date.now() + 60_000 ? value : null; } catch { return null; } }
export function saveMiniappSession(value: MiniappSession): void { try { uni.setStorageSync(KEY, value); } catch { /* non-blocking */ } }
