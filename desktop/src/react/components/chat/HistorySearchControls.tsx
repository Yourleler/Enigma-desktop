import type {HistorySearchFilters} from '../../../../../shared/history-search';
import {defaultHistoryFilters} from '../../../../../shared/history-search';
import {useStore} from '../../stores';
import {buildSessionProjectView} from '../session-sections';
import './HistorySearch.css';
export function HistorySearchControls({filters,onChange}:{filters:HistorySearchFilters;onChange:(filters:HistorySearchFilters)=>void}){
 const catalog=useStore(s=>s.sessionProjectCatalog),sessions=useStore(s=>s.sessions),models=useStore(s=>s.models);
 const view=buildSessionProjectView(sessions,catalog),projects=[...view.rootProjects,...view.folders.flatMap(folder=>folder.projects)].filter(project=>project.id!=='cwd:');
 const set=(key:keyof HistorySearchFilters,value:any)=>onChange({...filters,[key]:value});
 return <div className="enigma-history-filters">
  <div className="enigma-history-main-filters">
   <label>搜索范围<select aria-label="搜索范围" value={filters.scope} onChange={event=>set('scope',event.target.value)}><option value="all">标题和正文</option><option value="title">仅标题</option><option value="content">仅正文</option></select></label>
   <label>内容来源<select aria-label="搜索来源" value={filters.source} disabled={filters.scope==='title'} onChange={event=>onChange({...filters,scope:'content',source:event.target.value as any})}><option value="all">用户和模型</option><option value="user">用户输入</option><option value="assistant">模型回复</option></select></label>
   <label>匹配方式<select aria-label="匹配方式" value={filters.match} onChange={event=>onChange({...filters,match:event.target.value as any,caseSensitive:event.target.value==='smart'?false:filters.caseSensitive})}><option value="phrase">完整短语</option><option value="all">包含所有词</option><option value="smart">智能匹配</option></select></label>
  </div>
  <details className="enigma-history-advanced"><summary>高级筛选{filters.project||filters.model||filters.after||filters.before||filters.caseSensitive||filters.status!=='active'?' · 已设置':''}</summary><div>
   <label>项目<select aria-label="搜索项目" value={filters.project} onChange={event=>set('project',event.target.value)}><option value="">所有项目与独立对话</option><option value="cwd:">仅独立对话</option>{projects.map(project=><option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
   <label>模型<input aria-label="搜索模型" placeholder="名称或供应商，例如 kimi" list="history-search-models" value={filters.model} onChange={event=>onChange({...filters,scope:event.target.value?'content':filters.scope,model:event.target.value})}/><datalist id="history-search-models">{models.map(model=><option key={`${model.provider}/${model.id}`} value={model.id}/>)}</datalist></label>
   <label>更新时间起<input aria-label="搜索开始日期" type="date" value={filters.after} onChange={event=>set('after',event.target.value)}/></label><label>更新时间止<input aria-label="搜索结束日期" type="date" value={filters.before} onChange={event=>set('before',event.target.value)}/></label>
   <label>对话状态<select aria-label="搜索对话状态" value={filters.status} onChange={event=>set('status',event.target.value)}><option value="active">未归档</option><option value="archived">已归档</option><option value="all">全部</option></select></label>
   <label>排序<select aria-label="搜索排序" value={filters.sort} onChange={event=>set('sort',event.target.value)}><option value="relevance">相关程度</option><option value="newest">最近更新</option></select></label>
   <label className="enigma-history-checkbox"><input type="checkbox" disabled={filters.match==='smart'} aria-label="区分大小写" checked={filters.caseSensitive===true} onChange={event=>set('caseSensitive',event.target.checked)}/>区分大小写</label>
   <button type="button" onClick={()=>onChange({...defaultHistoryFilters})}>重置筛选</button>
  </div></details>
 </div>;
}
