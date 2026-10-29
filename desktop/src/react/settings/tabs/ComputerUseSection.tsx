import { useCallback, useEffect, useMemo, useState } from 'react';
import { hanaFetch } from '../api';
import { t } from '../helpers';
import { SettingsSection } from '../components/SettingsSection';
import { SettingsRow } from '../components/SettingsRow';
import { Toggle } from '@/ui';
import { useSettingsStore } from '../store';
import { updateSettingsSnapshot } from '../actions';
import styles from '../Settings.module.css';
import './ComputerUseSection.css';

interface ComputerProviderStatus {
  providerId: string;
  status?: {
    available?: boolean;
    reason?: string;
    error?: string;
    permissions?: Array<{ name?: string; granted?: boolean }>;
  };
}

interface ComputerUseStatusResponse {
  selectedProviderId?: string | null;
  status?: {
    enabled?: boolean;
    activeLease?: {
      leaseId?: string;
      agentId?: string | null;
      appId?: string | null;
    } | null;
    providers?: ComputerProviderStatus[];
  } | null;
  settings?: {
    enabled?: boolean;
    app_approvals?: Array<{ providerId: string; appId: string; appName?: string }>;
  };
}

function StatusText({ ok, text }: { ok: boolean; text: string }) {
  return (
    <span style={{
      color: ok ? 'var(--accent)' : 'var(--text-muted)',
      fontSize: '0.78rem',
      whiteSpace: 'normal',
      maxWidth: 280,
      overflowWrap: 'anywhere',
      textAlign: 'right',
      lineHeight: 1.5,
    }}>
      {text}
    </span>
  );
}

function rememberComputerUseSnapshot(data: ComputerUseStatusResponse) {
  updateSettingsSnapshot((snapshot) => ({
    ...snapshot,
    preferences: {
      ...snapshot.preferences,
      computerUse: data,
    },
  }));
}

export function ComputerUseSection({pluginEnabled=true}: {pluginEnabled?:boolean}) {
  const snapshotComputerUse = useSettingsStore(
    (state) => state.settingsSnapshot?.data?.preferences?.computerUse as ComputerUseStatusResponse | undefined,
  );
  const [data, setData] = useState<ComputerUseStatusResponse | null>(() => snapshotComputerUse || null);
  const [loading, setLoading] = useState(() => !snapshotComputerUse);
  const [saving, setSaving] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [loadError,setLoadError]=useState(false);
  const [revoking,setRevoking]=useState<string|null>(null);
  const showToast = useSettingsStore((state) => state.showToast);

  const load = useCallback(async () => {
    setLoading(true);setLoadError(false);
    try {
      const res = await hanaFetch('/api/preferences/computer-use');
      const body = await res.json();
      setData(body);
      rememberComputerUseSnapshot(body);
    } catch (err) {
      console.warn('[computer-use] load status failed:', err);
      setLoadError(true);
      const latestSnapshot = useSettingsStore.getState().settingsSnapshot?.data?.preferences?.computerUse as ComputerUseStatusResponse | undefined;
      setData(latestSnapshot || null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!snapshotComputerUse) return;
    setData(snapshotComputerUse);
    setLoading(false);
  }, [snapshotComputerUse]);

  useEffect(() => {
    load();
  }, [load]);

  const selectedProvider = useMemo(() => {
    const id = data?.selectedProviderId || null;
    return data?.status?.providers?.find((provider) => provider.providerId === id) || null;
  }, [data]);

  // data 未到位时传 undefined 给 Toggle，走加载态；加载完成后用真实 boolean。
  const enabled = data ? data.settings?.enabled === true : undefined;
  const available = selectedProvider?.status?.available === true;
  const availabilityIssue = selectedProvider?.status?.reason || selectedProvider?.status?.error || '';
  const permissions = selectedProvider?.status?.permissions || [];
  const permissionText = permissions.length > 0
    ? permissions.map((p) => `${/accessibility/i.test(p.name||'')?t('settings.computerUse.accessibilityName'):/screen.?record/i.test(p.name||'')?t('settings.computerUse.screenName'):p.name||'permission'} · ${t(p.granted?'settings.computerUse.permissionGranted':'settings.computerUse.permissionMissing')}`).join(' / ')
    : t('settings.computerUse.permissionsEmpty');
  const approvals = data?.settings?.app_approvals || [];
  const approvalsText = approvals.length > 0
    ? t('settings.computerUse.approvalsCount',{count:approvals.length})
    : t('settings.computerUse.approvalsEmpty');
  const activeLease = data?.status?.activeLease;
  const activeLeaseText = activeLease
    ? activeLease.appId || activeLease.agentId || activeLease.leaseId || t('settings.computerUse.active')
    : t('settings.computerUse.idle');
  const summaryKey=loadError?'loadFailed':!pluginEnabled?'pluginDisabled':!enabled?'controlDisabled':permissions.some(p=>!p.granted)?'permissionNeeded':!permissions.length?'permissionUnchecked':'readyHint';
  const runtimeText=availabilityIssue==='daemon-unavailable'?t('settings.computerUse.startOnDemand'):available?t('settings.computerUse.available'):!enabled?t('settings.computerUse.startOnDemand'):t('settings.computerUse.unavailable');
  const revoke=async(approval:{providerId:string;appId:string})=>{
    setRevoking(approval.appId);
    try{await hanaFetch('/api/preferences/computer-use/approvals',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify(approval)});await load();}
    catch(err){showToast(t('settings.saveFailed')+': '+(err instanceof Error?err.message:String(err)),'error');}
    finally{setRevoking(null);}
  };

  const saveEnabled = async (next: boolean) => {
    if (!data) return;
    setSaving(true);
    try {
      const res = await hanaFetch('/api/preferences/computer-use', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: { enabled: next } }),
      });
      const body = await res.json();
      const nextData = {
        ...(data || {}),
        settings: {
          ...(data?.settings || {}),
          ...(body.settings || {}),
        },
      };
      setData(nextData);
      rememberComputerUseSnapshot(nextData);
      await load();
    } catch (err: unknown) {
      showToast(t('settings.saveFailed') + ': ' + (err instanceof Error ? err.message : String(err)), 'error');
    } finally {
      setSaving(false);
    }
  };

  const requestPermissions = async () => {
    setRequesting(true);
    try {
      await hanaFetch('/api/preferences/computer-use/request-permissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId: data?.selectedProviderId || undefined }),
      });
      await load();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      showToast(`${t('settings.computerUse.requestPermissionsFailed')}: ${message}`, 'error');
    } finally {
      setRequesting(false);
    }
  };

  const refreshButton = (
    <button
      className={styles['settings-save-btn-sm']}
      onClick={load}
      disabled={loading}
      style={{ minWidth: 72 }}
    >
      {t('settings.computerUse.refresh')}
    </button>
  );

  const permissionsButton = (
    <button
      className={styles['settings-save-btn-sm']}
      onClick={requestPermissions}
      disabled={requesting || loading}
      style={{ minWidth: 120 }}
    >
      {t('settings.computerUse.requestPermissions')}
    </button>
  );

  return (
    <div id="computer-control-setup" className="enigma-computer-setup" tabIndex={-1}><SettingsSection
      title={t('settings.computerUse.title')}
      description={t('settings.computerUse.description')}
      context={refreshButton}
    >
      <div className="enigma-computer-readiness" role="status" data-ready={summaryKey==='readyHint'}>{t('settings.computerUse.'+summaryKey)}</div>
      <SettingsRow
        label={t('settings.computerUse.enabled')}
        hint={t('settings.computerUse.enabledHint')}
        control={<Toggle ariaLabel={t('settings.computerUse.enabled')} on={enabled} onChange={(next) => saveEnabled(next)} disabled={saving||!pluginEnabled} />}
      />
      <SettingsRow
        label={t('settings.computerUse.availability')}
        hint={available||availabilityIssue==='daemon-unavailable'?undefined:availabilityIssue || undefined}
        control={<StatusText ok={available} text={runtimeText} />}
      />
      <SettingsRow
        label={t('settings.computerUse.permissions')}
        hint={t('settings.computerUse.permissionsHint')}
        control={permissionsButton}
      />
      <SettingsRow
        label={t('settings.computerUse.permissionsStatus')}
        control={<StatusText ok={permissions.length>0&&permissions.every((p) => p.granted === true)} text={permissionText} />}
      />
      <SettingsRow
        label={t('settings.computerUse.approvals')}
        hint={t('settings.computerUse.approvalsHint')}
        control={<StatusText ok={approvals.length > 0} text={approvalsText} />}
      />
      {!!approvals.length&&<div className="enigma-computer-approvals">{approvals.map(approval=><div key={approval.providerId+approval.appId}><span title={approval.appId}>{approval.appName||approval.appId}</span><button type="button" disabled={revoking===approval.appId} onClick={()=>void revoke(approval)}>{t('settings.computerUse.revoke')}</button></div>)}</div>}
      <SettingsRow
        label={t('settings.computerUse.activeSession')}
        control={<StatusText ok={!activeLease} text={activeLeaseText} />}
      />
      <p className="enigma-computer-hint">{t('settings.computerUse.workflowHint')}</p>
    </SettingsSection></div>
  );
}
