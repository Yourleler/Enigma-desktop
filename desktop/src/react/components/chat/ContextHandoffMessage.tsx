import {useEffect, useRef} from 'react';
import type {ContextHandoff} from '../../../../../shared/context-handoff';
import {MarkdownContent} from './MarkdownContent';
import styles from './ContextHandoffMessage.module.css';

export function ContextHandoffMessage({value, html, searchQuery}: {value:ContextHandoff;html:string;searchQuery?:string}) {
  const source = useRef<HTMLDetailsElement>(null), full = useRef<HTMLDetailsElement>(null);
  useEffect(()=>{
    if (!searchQuery?.trim()) return;
    const query=searchQuery.trim().toLocaleLowerCase();
    if (value.notes.some(note=>note.text.toLocaleLowerCase().includes(query)) && source.current) source.current.open=true;
    else if (full.current?.textContent?.toLocaleLowerCase().includes(query)) full.current.open=true;
  },[searchQuery,value]);
  return <div className={styles.context}>
    <p className={styles.goal}>{value.goal}</p>
    <p className={styles.hint}>{value.mode==='background'?'沿用所选背景，开始新目标；不会自动执行旧任务。':'已带入来源背景；继续前需要核对当前文件和权限。'}</p>
    {value.notes.length>0&&<details ref={source}>
      <summary>携带的背景 · {value.notes.length} 条{value.repositories.length?` · ${value.repositories.length} 个仓库`:''}</summary>
      {value.notes.map((note,index)=><section key={`${note.reference}:${index}`}><small>{note.role==='user'?'原用户输入':note.role==='assistant'?'原助手回复':'来源材料'}</small><p>{note.text}</p></section>)}
      {!!value.repositories.length&&<p className={styles.hint}>关联仓库：{value.repositories.join('、')}</p>}
    </details>}
    <details ref={full} className={styles.full}><summary>完整交接内容与来源</summary><MarkdownContent html={html}/></details>
  </div>;
}
