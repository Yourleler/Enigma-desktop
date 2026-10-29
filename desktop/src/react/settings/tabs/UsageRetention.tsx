import { useEffect, useState } from 'react';
import { hanaFetch } from '../api';
import { SettingsSection } from '../components/SettingsSection';
import { isUsageRetention, MIN_USAGE_RETENTION, MAX_USAGE_RETENTION } from '../../../../../shared/usage-retention';
import './UsageRetention.css';

export function UsageRetention({ connection, onSaved }: { connection: string | null; onSaved: () => void }) {
  const [snapshot, setSnapshot] = useState<{ maximum: number; retained: number } | null>(null);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    const abort = new AbortController(); setSnapshot(null); setValue(''); setNotice('');
    void hanaFetch('/api/usage/retention', { signal: abort.signal }).then(r => r.json()).then(data => {
      if (!abort.signal.aborted) { setSnapshot(data); setValue(String(data.maximum)); }
    }).catch(() => { if (!abort.signal.aborted) setNotice('保留设置暂时无法读取，请重新打开此页。'); });
    return () => abort.abort();
  }, [connection]);
  const maximum = Number(value), valid = isUsageRetention(maximum);
  const removed = snapshot && valid ? Math.max(0, snapshot.retained - maximum) : 0;
  const save = async () => {
    if (!snapshot || !valid || busy) return;
    setBusy(true); setNotice('');
    try {
      const response = await hanaFetch('/api/usage/retention', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ maximum }) });
      const data = await response.json(); setSnapshot(data); setValue(String(data.maximum)); setNotice('已保存，后续请求立即使用此上限。'); onSaved();
    } catch (error) { setNotice(error instanceof Error ? error.message : '保存失败，原记录未改动。'); }
    finally { setBusy(false); }
  };
  return <SettingsSection title="历史记录保留">
    <div className="usage-retention">
      <label htmlFor="usage-retention-limit">最多保留的请求数</label>
      <div className="usage-retention-control"><input id="usage-retention-limit" type="number" inputMode="numeric" min={MIN_USAGE_RETENTION} max={MAX_USAGE_RETENTION} step={1}
        value={value} disabled={!snapshot || busy} onChange={e => { setValue(e.target.value); setNotice(''); }} aria-invalid={!!snapshot && !valid}/><span>条</span>
        <button type="button" disabled={!snapshot || !valid || busy || maximum === snapshot.maximum} onClick={() => void save()}>{busy ? '保存中…' : '保存'}</button>
      </div>
      <p>范围 100–100,000 条，默认 5,000 条。按模型请求计数；达到上限后保留最新记录。</p>
      {snapshot && <p>当前保留 {snapshot.retained.toLocaleString()} 条。不会删除对话内容。{removed > 0 && `保存后将移除最早的 ${removed.toLocaleString()} 条用量记录；提高上限不能找回已移出的记录。`}</p>}
      {notice && <p role="status">{notice}</p>}
    </div>
  </SettingsSection>;
}
