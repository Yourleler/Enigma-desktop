import { useEffect, useRef, useState } from 'react';
import { AppIcon } from '../ui/app-icons';
import { Toggle } from '../ui/Toggle';
import './WorkspaceChooser.css';

interface Props {
  initialRoot: string;
  initialMemory: boolean;
  nativePicker: boolean;
  busy: boolean;
  error: string;
  canConnect: boolean;
  onConnect: (root: string, memory: boolean) => void;
  onCancel: () => void;
}

export function WorkspaceChooser({ initialRoot, initialMemory, nativePicker, busy, error, canConnect, onConnect, onCancel }: Props) {
  const [root, setRoot] = useState(initialRoot);
  const [memory, setMemory] = useState(initialMemory);
  const [manual, setManual] = useState(!nativePicker);
  const [picking, setPicking] = useState(nativePicker);
  const [pickerError, setPickerError] = useState('');
  const alive = useRef(true), pending = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const browse = async (initial = false) => {
    if (pending.current || busy) return;
    pending.current = true; setPicking(true); setPickerError('');
    try {
      const folder = await window.platform.selectFolder();
      if (!alive.current) return;
      if (folder) { setRoot(folder); setManual(false); }
      else if (initial) onCancel();
    } catch { if (alive.current) setPickerError('无法打开系统文件夹窗口，请重试或手动输入路径。'); }
    finally { pending.current = false; if (alive.current) setPicking(false); }
  };
  useEffect(() => {
    alive.current = true;
    // A deferred launch avoids opening two native sheets during StrictMode's
    // setup/cleanup probe. Unmounting also discards a late picker result.
    const timer = nativePicker ? setTimeout(() => { void browse(true); }, 0) : null;
    return () => { alive.current = false; if (timer !== null) clearTimeout(timer); };
  }, []);
  useEffect(() => { if (manual) input.current?.focus(); }, [manual]);
  const trimmed = root.trim();
  const folderName = trimmed.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || trimmed;
  return <form className="enigma-workspace-chooser" noValidate onSubmit={event => {
    event.preventDefault();
    if (trimmed && !busy && !picking && canConnect) onConnect(trimmed, memory);
  }}>
    <p className="enigma-workspace-intro">选择项目文件夹，其他协作仓库可以稍后加入。</p>
    <div className="enigma-workspace-folder">
      <span className="enigma-workspace-folder-icon"><AppIcon name="project" size={27}/></span>
      <div className="enigma-workspace-folder-copy">
        <strong>{picking ? '正在选择文件夹…' : folderName || '尚未选择文件夹'}</strong>
        <span>{trimmed || (nativePicker ? '在系统窗口中选择项目所在的文件夹' : '填写当前服务所在电脑上的目录路径')}</span>
      </div>
      {nativePicker && <button type="button" className="enigma-workspace-browse" disabled={busy || picking} onClick={() => void browse()}>{trimmed ? '更换文件夹' : '选择文件夹'}</button>}
    </div>
    {nativePicker && !manual && <button type="button" className="enigma-workspace-manual" disabled={busy || picking} onClick={() => setManual(true)}>手动输入路径</button>}
    {manual && <label className="enigma-workspace-path">
      <span>{nativePicker ? '目录路径' : '服务端目录路径'}</span>
      <input ref={input} aria-label="工程工作区目录" value={root} disabled={busy || picking} placeholder="项目文件夹的完整路径" onChange={event => setRoot(event.target.value)} autoComplete="off" spellCheck={false}/>
      {!nativePicker && <small>网页或远程连接不能直接使用本机文件夹窗口，请填写当前服务可访问的路径。</small>}
    </label>}
    <div className="enigma-workspace-memory">
      <div><strong>工程记忆</strong><p>保留项目约定和已验证的经验，供后续任务参考。</p></div>
      <Toggle ariaLabel="工程记忆" on={memory} disabled={busy || picking} onChange={setMemory}/>
    </div>
    {(pickerError || error) && <p className="enigma-workspace-error" role="alert">{pickerError || error}</p>}
    <footer className="enigma-workspace-actions">
      <span>{!canConnect ? '请先创建一个工作对话' : !trimmed && !picking ? '请先选择文件夹' : ''}</span>
      <button type="button" onClick={onCancel} disabled={busy}>取消</button>
      <button type="submit" className="enigma-primary" disabled={busy || picking || !canConnect || !trimmed}>{busy ? '正在连接…' : '连接工作区'}</button>
    </footer>
  </form>;
}
