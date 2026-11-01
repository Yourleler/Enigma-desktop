import {SearchField} from '../ui/SearchField';
import { useState } from 'react';
import { groups, openGroup, showAction, useEngineering } from './state';
import { presentAction } from './interaction-copy';
import { SurfaceModal } from './SurfaceMenu';
import {assistedOperations,composeTaskRequest} from './compose-task';
import {ModelPolicyDialog} from './ModelPolicy';
import {ConductorCreateDialog} from './ConductorCreate';
import {AppIcon} from '../ui/app-icons';

const dedicatedFeatures=[
  {id:'guardian',title:'托管与独立诊断',description:'持续观察、停止观察、查询进展，在允许范围内处理明确故障。',group:'observer'},
  {id:'runtime-history',title:'运行回执与历史',description:'查看当前阶段、等待原因和重启后仍保留的操作结果。',group:'observer'},
  {id:'memory-dream',keywords:'做梦 dream',title:'记忆整理与反馈',description:'在后台整理记忆：选择来源、查看候选、确认保存，并评价整理效果。',group:'memory'},
  {id:'model-policy',title:'多模型分工与切换',description:'设置规划、执行、复核模型，以及当前对话或未来任务的请求预算。',dialog:'models'},
  {id:'create-conductor',title:'创建任务编排管家',description:'用独立对话安排工作任务、依赖、模型和并发范围。',dialog:'conductor'},
  {id:'conductor-controls',title:'任务群控制',description:'查看前置成果、停止单个工作对话、预览成果并生成工作报告。',group:'conductor'},
];

/** The catalogue is derived from the host action registry, so specialized
 * layouts can never silently remove an operation's discoverable entry. */
export function ActionCatalog({close}:{close:()=>void}) {
  const snapshot=useEngineering(s=>s.snapshot),[query,setQuery]=useState('');
  const [dialog,setDialog]=useState<'models'|'conductor'|null>(null);
  const actions=(snapshot?.actions||[]).map(presentAction).filter((a:any)=>`${a.title} ${a.description} ${groups.find(g=>g.id===a.group)?.label}`.toLowerCase().includes(query.toLowerCase()));
  const busy=snapshot?.state?.idle===false||snapshot?.state?.operation?.state==='running';
  const assisted=assistedOperations.filter(action=>(action.id!=='conductor-plan'||snapshot?.kind==='manager')&&`${action.title} ${action.description}`.includes(query));
  const dedicated=dedicatedFeatures.filter(feature=>(feature.id!=='conductor-controls'||snapshot?.kind==='manager')&&`${feature.title} ${feature.description} ${feature.keywords||''}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  if(dialog==='models')return <ModelPolicyDialog close={close}/>;
  if(dialog==='conductor')return <ConductorCreateDialog close={close}/>;
  return <SurfaceModal onClose={close} initialFocus="input"><div className="enigma-modal-backdrop"><section className="enigma-modal enigma-operation-catalog" role="dialog" data-glass-frame="sheet" data-glass-controls="" aria-modal="true" aria-label="全部工程操作">
    <header><h2>全部工程操作</h2><button aria-label="关闭操作目录" data-tooltip="关闭操作目录" onClick={close}><AppIcon name="close" size={17}/></button></header>
    <p>按用途查找已有能力。需要先预览的操作会带你进入相应流程。</p>
    <SearchField className="enigma-timeline-search" aria-label="搜索工程操作" placeholder="搜索功能、操作或用途…" value={query} onChange={e=>setQuery(e.target.value)}/>
    <div className="enigma-catalog-list">{dedicated.length>0&&<section><h3>专用功能与设置</h3>{dedicated.map(feature=><button key={feature.id} data-feature-id={feature.id} onClick={()=>{if(feature.dialog)setDialog(feature.dialog as 'models'|'conductor');else{close();openGroup(feature.group!);}}}><span>{feature.title}</span><small>{feature.description}</small></button>)}</section>}{assisted.length>0&&<section><h3>交给助手处理 · 先填入输入框</h3>{assisted.map(action=><button key={action.id} data-assisted-action={action.id} onClick={()=>{close();openGroup(action.group);composeTaskRequest(action.prompt);}}><span>{action.title}</span><small>{action.description}</small></button>)}</section>}{groups.map(group=>{const items=actions.filter((a:any)=>a.group===group.id);return items.length>0&&<section key={group.id}><h3>{group.label}</h3>{items.map((action:any)=><button key={action.id} data-action-id={action.id} disabled={busy&&action.id!=='observer-question'} onClick={()=>{close();openGroup(action.group);if(!['restore','observer-question'].includes(action.id))void showAction(action);}}><span>{action.title}{action.id==='restore'?' · 先选择快照并预览':action.id==='observer-question'?' · 不打断当前任务':''}</span><small>{action.description}</small></button>)}</section>})}</div>
    {!actions.length&&!assisted.length&&!dedicated.length&&<p>没有匹配的操作，换个关键词试试。</p>}
    {busy&&<p role="status">当前任务正在执行，结束后可发起新操作；运行状态可随时通过独立旁路查看。</p>}
  </section></div></SurfaceModal>;
}
