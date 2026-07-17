let sessionId: string | null = null;

export function getSessionId(): string {
  if (!sessionId) {
    sessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
  }
  return sessionId;
}
