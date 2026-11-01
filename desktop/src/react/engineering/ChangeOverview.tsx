import {useMemo} from 'react';
export function ChangeOverview({publication,onSource}:{publication:any;onSource:(anchor:any)=>void}){
 const summary=useMemo(()=>{
  const counts={added:0,modified:0,deleted:0,renamed:0,unknown:0};let added=0,removed=0,partial=false,counted=0;
  for(const file of publication.changes){counts[file.change as keyof typeof counts]=(counts[file.change as keyof typeof counts]||0)+1;
   if(!file.patch||file.patchTruncated){partial=true;continue;}
   counted++;let hunk=false;for(const line of file.patch.split('\n')){if(line.startsWith('@@')){hunk=true;continue;}if(!hunk)continue;if(line.startsWith('+'))added++;else if(line.startsWith('-'))removed++;}
  }
  return {counts,added,removed,partial,counted};
 },[publication.version,publication.changes]);
 return <section className="enigma-change-overview" aria-label="变更概览">
  <div><strong>{publication.changes.length} 个变更文件</strong>{summary.counted>0?<><span className="enigma-lines-added">+{summary.added}</span><span className="enigma-lines-removed">−{summary.removed}</span></>:publication.changes.length>0&&<small>文本行数未统计</small>}{summary.partial&&summary.counted>0&&<small>行数仅含可完整读取的文本</small>}</div>
  <p>新增 {summary.counts.added} · 修改 {summary.counts.modified} · 删除 {summary.counts.deleted}{summary.counts.renamed>0&&` · 重命名 ${summary.counts.renamed}`}{summary.counts.unknown>0&&` · 范围未定 ${summary.counts.unknown}`}</p>
  <details><summary>查看文件与仓库 <small>{publication.roots.length} 个目录</small></summary>
   {publication.roots.map((repo:any)=>{const files=publication.changes.filter((f:any)=>f.repo===repo.id);return <div key={repo.id}><strong>{repo.name||repo.id}</strong><small>{repo.role}{repo.dependsOn?.length?` · 依赖 ${repo.dependsOn.map((id:string)=>publication.roots.find((r:any)=>r.id===id)?.name||id).join('、')}`:''}</small>{files.map((file:any)=><button key={file.file} onClick={()=>onSource({repo:file.repo,file:file.file,line:1})}>{file.file}</button>)}{!files.length&&<p>此范围未改动</p>}</div>;})}
  </details>
 </section>;
}
