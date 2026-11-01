import {useState} from 'react';
import {readingText} from './reading-copy';
const statusNames:Record<string,string>={symbols:'符号片段',excerpt:'文本片段',deleted:'文件已删除',budget:'超出读取预算',unavailable:'暂无文本片段'};
export function ReadingCoverage({reading,onSource}:{reading:any;onSource?:(anchor:any)=>void}){
 const [limit,setLimit]=useState(40);
 const [groupLimit,setGroupLimit]=useState(10),[openGroups,setOpenGroups]=useState<Record<string,boolean>>({});
 if(!reading)return null;
 const coverage=reading.sourceCoverage,model=reading.modelCoverage,files=coverage?.files||[],acquired=files.filter((f:any)=>f.status==='symbols'||f.status==='excerpt').length;
 return <details className="enigma-reading-coverage"><summary>源码展开范围{coverage?` · ${acquired} / ${files.length} 个变更文件有片段`:reading.truncated?' · 仍有未展开内容':''}{model&&` · 模型解读 ${model.completedRequests}/${model.plannedRequests} 批`}</summary>
  <p>拿到源码片段不代表完整审查或测试通过；文件类型和阅读顺序也不代表重要性。</p>
  {model?<section aria-label="模型解读材料范围"><p>{model.status==='complete'?'本次分批解读已完成。':model.status==='pending'?'源码分析已保留，模型解读尚未完成。':'模型解读尚未全部完成；仅保留已通过来源校验的说明。'}已发起 {model.requests} 次请求，{model.completedRequests} 批返回有效解读。</p><p>请求材料包含 {model.nodes} / {model.totalNodes} 个源码片段、{model.changes} / {model.totalChanges} 个文件变更摘要、{model.edges} / {model.totalEdges} 条关系。未提供的跨批次关系不能当作已解读。</p>{(model.clippedNodes>0||model.clippedPatches>0)&&<p>为控制单次材料长度，{model.clippedNodes} 个源码片段和 {model.clippedPatches} 个差异摘要有裁剪；可打开完整源码和 Diff 核对。</p>}<p>这些数字说明请求材料范围，不证明模型逐字理解，也不等于计费Token。</p></section>:<p>该记录未保存模型请求的材料范围，不能推断模型已经看过全部源码。</p>}
  {coverage?<>
   <p>符号查询 {coverage.symbolQueries.completed} / {coverage.symbolQueries.limit} 次{coverage.symbolQueries.pending?`，还有 ${coverage.symbolQueries.pending} 个候选未展开`:''}。{coverage.outlineFiles.total>0&&`已检查 ${coverage.outlineFiles.examined} / ${coverage.outlineFiles.total} 个候选文件的入口。`}</p>
   <ul>{files.slice(0,limit).map((file:any)=><li key={`${file.repo}:${file.file}`}><span>{onSource?<button onClick={()=>onSource({repo:file.repo,file:file.file,line:1,side:file.status==='deleted'?'baseline':'target'})}>{file.repo} / {file.file}</button>:`${file.repo} / ${file.file}`}</span><small>{statusNames[file.status]||'未记录'}{file.partial?' · 片段有截断':''}</small>{file.reason&&<p>{file.reason}</p>}</li>)}</ul>
   {files.length>limit&&<button onClick={()=>setLimit(v=>v+40)}>继续显示文件范围（剩余 {files.length-limit}）</button>}
  </>:<p>旧记录没有保存逐文件展开范围，不能仅凭节点数量判断是否完整覆盖。重新生成阅读可记录这一范围。</p>}
  {onSource&&reading.groups?.length>0&&<details><summary>按源码关联浏览 · {reading.groups.length} 组</summary><p>分组只依据已确认的静态关系；文件命名线索不免除审查。</p>{reading.groups.slice(0,groupLimit).map((group:any,index:number)=><details key={group.id} onToggle={e=>{const open=e.currentTarget.open;setOpenGroups(values=>values[group.id]===open?values:{...values,[group.id]:open});}}><summary>关联组 {index+1} · {group.files.length} 个文件{group.classification==='mechanical-candidate'?' · 可能为生成内容':''}</summary>{openGroups[group.id]&&group.files.map((file:any)=><p key={`${file.repo}:${file.file}`}><button onClick={()=>onSource({repo:file.repo,file:file.file,line:1,side:file.change==='deleted'?'baseline':'target'})}>{file.repo} / {file.file}</button></p>)}</details>)}{reading.groups.length>groupLimit&&<button onClick={()=>setGroupLimit(v=>v+10)}>继续显示关联组</button>}</details>}
  {!!reading.gaps?.length&&<details><summary>未展开范围与诊断 · {reading.gaps.length}</summary>{reading.gaps.map((gap:string,i:number)=><p key={i}>{readingText(gap)}</p>)}</details>}
 </details>;
}
