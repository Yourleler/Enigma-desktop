import { useStore } from '../stores';
import { hanaFetch } from '../hooks/use-hana-fetch';
import { switchSession } from '../stores/session-actions';
import { previewConnectionKey } from '../utils/preview-context';
import type { DesktopNotificationTarget, Activity } from '../types';

let requestVersion = 0;

/** A notification belongs to the connection and task that emitted it. */
export async function openNotificationTarget(target: DesktopNotificationTarget): Promise<void> {
  const version = ++requestVersion;
  if (!target || target.connectionKey !== previewConnectionKey()) {
    useStore.getState().addToast('这条通知来自其他连接，请切回原连接后再打开。', 'info');
    return;
  }
  const origin = useStore.getState();
  const current = () => version === requestVersion && target.connectionKey === previewConnectionKey();
  if (target.activityId && target.agentId) {
    try {
      const response = await hanaFetch('/api/desk/activities', { throwOnHttpError: false });
      const data = await response.json();
      if (!current()) return;
      const state = useStore.getState();
      if (state.currentSessionPath !== origin.currentSessionPath || state.currentTab !== origin.currentTab || state.activePanel !== origin.activePanel) return;
      if (!response.ok || !Array.isArray(data.activities)) throw Error('运行记录暂不可读取，请稍后重试。');
      const activity = data.activities.find((row: Activity) => row.id === target.activityId && row.agentId === target.agentId);
      if (!activity) throw Error('这条通知对应的运行记录已不存在。');
      useStore.setState({ activities: data.activities, currentTab: 'chat', activePanel: 'activity',
        activityFocusTarget: { id: target.activityId, agentId: target.agentId, revision: version, connectionKey: target.connectionKey } });
    } catch (error) {
      if (current()) useStore.getState().addToast(error instanceof Error ? error.message : '无法打开通知对应的运行记录。', 'error');
    }
    return;
  }
  if (typeof target.sessionPath === 'string' && target.sessionPath.trim()) {
    useStore.setState({ currentTab: 'chat' });
    await switchSession(target.sessionPath);
  }
}
