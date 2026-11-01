import type { PermissionMode } from '../components/input/PlanModeButton';

export interface QuickChatRuntimeAgent {
  id: string;
  name?: string | null;
  yuan?: string | null;
  hasAvatar?: boolean;
  isPrimary?: boolean;
  isCurrent?: boolean;
  memoryMasterEnabled?: boolean;
}

export function pickQuickChatRuntimeAgent(
  agents: QuickChatRuntimeAgent[],
  fallbackAgentId?: string | null,
): QuickChatRuntimeAgent | null {
  if (!Array.isArray(agents) || agents.length === 0) return null;
  return agents.find((agent) => agent.isCurrent)
    || (fallbackAgentId ? agents.find((agent) => agent.id === fallbackAgentId) : null)
    || agents.find((agent) => agent.isPrimary)
    || agents[0]
    || null;
}

export function shouldAdoptRuntimeAgentForQuickChat(sessionPath: string | null): boolean {
  return !sessionPath;
}

export function resolveQuickChatPermissionMode(data: any): PermissionMode {
  return (data?.permissionMode || data?.defaultMode || data?.mode || 'ask') as PermissionMode;
}

/** Wait only for transport readiness. A timeout never schedules a later send. */
export function waitForQuickChatSocket(ws: WebSocket, signal: AbortSignal, timeoutMs = 10_000): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason);
  if (ws.readyState === WebSocket.OPEN) return Promise.resolve();
  if (ws.readyState !== WebSocket.CONNECTING) return Promise.reject(new Error('quick-chat-connection-closed'));
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      ws.removeEventListener('open', opened);
      ws.removeEventListener('error', closed);
      ws.removeEventListener('close', closed);
      signal.removeEventListener('abort', aborted);
    };
    const opened = () => { cleanup(); resolve(); };
    const closed = () => { cleanup(); reject(new Error('quick-chat-connection-closed')); };
    const aborted = () => { cleanup(); reject(signal.reason); };
    const timer = setTimeout(() => { cleanup(); reject(new Error('quick-chat-connection-timeout')); }, timeoutMs);
    ws.addEventListener('open', opened, {once: true});
    ws.addEventListener('error', closed, {once: true});
    ws.addEventListener('close', closed, {once: true});
    signal.addEventListener('abort', aborted, {once: true});
  });
}
