import {useEffect,useRef,useState} from 'react';
import {useStore} from '../../stores';
import {SelectWidget} from '../../ui/SelectWidget';
import {AppIcon} from '../../ui/app-icons';
import {loadSessionProjectCatalog,patchSessionProjectInCatalog,setSessionProjectAssignmentForSession} from '../../stores/session-project-actions';
import {activateWorkspaceDesk} from '../../stores/desk-actions';
import {closePreview} from '../../stores/preview-actions';
import {autoProjectIdForCwd,cwdFromAutoProjectId,UNCATEGORIZED_PROJECT_ID} from '../../../../../shared/session-projects';
import {buildSessionProjectView} from '../session-sections';
import {sessionScopedListIncludes} from '../../stores/session-slice';
import './ProjectContextBar.css';

export function ProjectContextBar({compact=false}:{compact?:boolean}={}){
  const sessions=useStore(s=>s.sessions),path=useStore(s=>s.currentSessionPath),pendingId=useStore(s=>s.pendingProjectId),catalog=useStore(s=>s.sessionProjectCatalog),connection=useStore(s=>s.activeServerConnectionId);
  const folder=useStore(s=>s.selectedFolder||s.deskBasePath),switching=useStore(s=>!!s.pendingSessionSwitchPath),running=useStore(s=>!!s.currentSessionPath&&sessionScopedListIncludes(s,s.streamingSessions,s.currentSessionPath));
  const session=sessions.find(s=>s.path===path);
  const id=path?(session?.projectId||autoProjectIdForCwd(session?.cwd)):(pendingId||UNCATEGORIZED_PROJECT_ID);
  const view=buildSessionProjectView(sessions,catalog);
  const projects=[...view.rootProjects,...view.folders.flatMap(f=>f.projects)].filter(p=>p.id!==UNCATEGORIZED_PROJECT_ID);
  if(id!==UNCATEGORIZED_PROJECT_ID&&!projects.some(p=>p.id===id)&&cwdFromAutoProjectId(id))projects.push({id,name:cwdFromAutoProjectId(id)!.split(/[\\/]/).pop()||'当前目录',source:'cwd',folderId:null,order:0,items:[]});
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const request=useRef(0);
  useEffect(()=>{setError('');setBusy(false);request.current++;void loadSessionProjectCatalog().catch(()=>setError('项目目录暂时未加载')); },[connection,path]);
  const choose=async(next:string)=>{
    const token=++request.current;setBusy(true);setError('');
    try{
      if(path)await setSessionProjectAssignmentForSession(path,next);
      else{
        useStore.setState({pendingProjectId:next});
        const selected=catalog.projects.find(p=>p.id===next),cwd=selected?.workspacePath||cwdFromAutoProjectId(next);
        if(cwd){useStore.setState({selectedFolder:cwd});await activateWorkspaceDesk(cwd);if(token===request.current)closePreview();}
      }
    }catch(e){if(token===request.current)setError(e instanceof Error?e.message:'无法更改项目');}
    finally{if(token===request.current)setBusy(false);}
  };
  return <div className="enigma-project-context" data-compact={compact||undefined}>
    <AppIcon name="project" size={16}/>
    <SelectWidget ariaLabel="对话归属项目" value={id} disabled={busy||running||switching} options={[{value:UNCATEGORIZED_PROJECT_ID,label:'未归属项目',description:'作为单独对话保留'},...projects.map(p=>({value:p.id,label:p.name,description:catalog.projects.find(r=>r.id===p.id)?.workspacePath||cwdFromAutoProjectId(p.id)||'共享项目背景与笔记'}))]} onChange={next=>void choose(next)} popupMinWidth={280}/>
    {running&&<span>运行中，结束后可调整归属</span>}
    {error&&<span role="alert">{error}</span>}
  </div>;
}

export function ProjectSettings({id,name,record,onClose}:{id:string;name:string;record?:ReturnType<typeof useStore.getState>['sessionProjectCatalog']['projects'][number];onClose:()=>void}){
  const [brief,setBrief]=useState(record?.sharedContext||''),[notes,setNotes]=useState(record?.sharedNotes||''),[repos,setRepos]=useState(record?.repositoryPaths?.join('\n')||''),[root,setRoot]=useState(record?.workspacePath||cwdFromAutoProjectId(id)||'');
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const form=useRef<HTMLFormElement>(null);
  const [originalUpdatedAt]=useState(record?.updatedAt??null);
  useEffect(()=>{const previous=document.activeElement as HTMLElement|null;form.current?.querySelector('textarea')?.focus();return()=>{if(previous?.isConnected)previous.focus();};},[]);
  return <div className="enigma-project-settings-backdrop" data-native-browser-occluder="" onMouseDown={e=>{if(e.target===e.currentTarget&&!busy)onClose();}}>
    <form ref={form} className="enigma-project-settings" role="dialog" aria-modal="true" aria-label="项目共享设置" data-liquid="sheet" onKeyDown={e=>{if(e.key==='Escape'&&!busy){e.preventDefault();e.stopPropagation();onClose();}if(e.key==='Tab'){const controls=[...e.currentTarget.querySelectorAll<HTMLElement>('input:not(:disabled),textarea:not(:disabled),button:not(:disabled)')];if(e.shiftKey&&document.activeElement===controls[0]){e.preventDefault();controls.at(-1)?.focus();}else if(!e.shiftKey&&document.activeElement===controls.at(-1)){e.preventDefault();controls[0]?.focus();}}}} onSubmit={async e=>{e.preventDefault();if(busy)return;setBusy(true);setError('');try{const paths=repos.split('\n').map(p=>p.trim()).filter(Boolean);if([root,...paths].some(p=>p&&!/^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(p)))throw new Error('请使用完整目录路径');const saved=await patchSessionProjectInCatalog(id,{name,workspacePath:root.trim()||null,sharedContext:brief,sharedNotes:notes,repositoryPaths:paths,expectedUpdatedAt:originalUpdatedAt});if(!saved)throw new Error('保存失败，请重试');onClose();}catch(error){setError(error instanceof Error?error.message:'保存失败');}finally{setBusy(false);}}}>
      <header><div><strong>{name}</strong><p>项目设置</p></div><button className="enigma-project-settings-close" type="button" disabled={busy} onClick={onClose} aria-label="关闭项目共享设置"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></header>
      <p className="enigma-project-context-note">下次模型请求会读取这里的最新内容。对话历史分别保留；资料路径不会自动扩大文件访问权限。</p>
      <label>共享说明<textarea aria-label="项目共享说明" maxLength={12000} value={brief} disabled={busy} onChange={e=>setBrief(e.target.value)} placeholder="项目目标、架构、约定和完成标准…"/></label>
      <label>共享笔记<textarea aria-label="项目共享笔记" maxLength={12000} value={notes} disabled={busy} onChange={e=>setNotes(e.target.value)} placeholder="经确认的结论、需要接续的事项、文档位置…"/></label>
      <label>默认工作目录（可选）<input aria-label="项目默认目录" value={root} disabled={busy} onChange={e=>setRoot(e.target.value)}/></label>
      <label>其他项目目录（可选，每行一个）<textarea aria-label="项目协作目录" value={repos} disabled={busy} onChange={e=>setRepos(e.target.value)} rows={2}/></label>
      <p className="enigma-project-context-note">项目可以只归拢对话，也可以关联多个目录。默认目录用于新对话；多个 Git 仓库可在“仓库”中设置依赖与读写权限。调整归属不会移动文件。</p>
      {error&&<p role="alert">{error}</p>}
      <footer><button type="button" disabled={busy} onClick={onClose}>取消</button><button type="submit" disabled={busy}>{busy?'正在保存…':'保存项目设置'}</button></footer>
    </form>
  </div>;
}
