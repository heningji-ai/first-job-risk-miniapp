const KEY = "first_job_goal_fit_miniapp_session_v1";
export type MiniappSession = { sessionToken: string; expiresAt: string };
export function readStoredMiniappSession(): MiniappSession | null { try { const value = uni.getStorageSync(KEY) as MiniappSession; return value?.sessionToken && typeof value.expiresAt === "string" ? value : null; } catch { return null; } }
export function readMiniappSession(): MiniappSession | null { const value = readStoredMiniappSession(); return value && new Date(value.expiresAt).getTime() > Date.now() + 60_000 ? value : null; }
export function saveMiniappSession(value: MiniappSession): void { try { uni.setStorageSync(KEY, value); } catch { /* non-blocking */ } }
export function clearMiniappSession(): void { try { uni.removeStorageSync(KEY); } catch { /* non-blocking */ } }
