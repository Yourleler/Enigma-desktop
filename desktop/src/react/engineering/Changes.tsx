import { GlassSelection } from '../ui/GlassSelection';
import { useState, useId, useRef, useEffect } from "react";
import { useEngineering, showAction, openEngineering,rememberEngineeringView } from "./state";
import {SurfaceMenu} from './SurfaceMenu';
import {TaskMaps} from './TaskMaps';
import {useStore} from '../stores';
const chapterLabels:Record<string,string>={entry:'入口与调用',contract:'接口与契约',implementation:'核心实现',consumer:'消费方与引用',test:'测试与验证',configuration:'配置',documentation:'文档'};
function omission(text:string){return ({'Nonregular Git object; retained in diff metadata only':'这是符号链接或其他特殊Git对象，仅保留变更元数据。','File exceeds reading budget':'文件超过单次读取上限，未展开文本。','Binary or source reading budget exceeded':'二进制文件或内容超过读取上限，未展开文本。','Non-UTF8 source':'文件不是UTF-8文本，未展开。'} as Record<string,string>)[text]||text;}

export function Changes({
  value,
  files,
}: {
  value: any;
  files: React.ReactNode;
}) {
  const modes=['diff','smart','files','maps'] as const;
  const section=useEngineering(state=>state.sections?.reading),view=modes.includes(section as any)?section as typeof modes[number]:'smart';
  const setView=(next:typeof modes[number])=>{useEngineering.setState(state=>({sections:{...state.sections,reading:next}}));rememberEngineeringView();};
  const [selected, setSelected] = useState("");
  const [filter,setFilter]=useState('');
  const [fullPatch,setFullPatch]=useState(''),[expanding,setExpanding]=useState(false),[expandError,setExpandError]=useState('');
  const expansion=useRef(0);
  const tabs=useRef<Record<string,HTMLButtonElement|null>>({}),tabId=useId();
  const state = useEngineering(),
    publication = value?.changeReading,
    record = publication?.record;
  const changes = record?.changes || [],
    reading = record?.reading;
  const busy=state.snapshot?.state?.idle===false||state.snapshot?.state?.operation?.state==='running';
  const readOnly=useStore(s=>s.sessionPermissionMode==='read_only');
  const matching=changes.filter((item:any)=>`${item.repo}/${item.file}`.toLowerCase().includes(filter.toLowerCase()));
  const file =
    matching.find((file: any) => `${file.repo}:${file.file}` === selected) ||
    matching[0];
  useEffect(()=>{expansion.current++;setFullPatch('');setExpanding(false);setExpandError('');},[record?.version,file?.repo,file?.file]);
  const clipped=file?.patchTruncated||file?.patch?.length===120000;
  const shownPatch=fullPatch||file?.patch;
  const plainDiff=!!shownPatch&&shownPatch.split('\n').length>2000;
  const expand=async()=>{
    const generation=++expansion.current;setExpanding(true);setExpandError('');
    try{const {createTwoFilesPatch}=await import('diff');const result=createTwoFilesPatch(`${file.repo}/${file.file}`,`${file.repo}/${file.file}`,file.before?.content||'',file.after?.content||'');if(expansion.current===generation)setFullPatch(result);}
    catch(error){if(expansion.current===generation)setExpandError(String(error));}
    finally{if(expansion.current===generation)setExpanding(false);}
  };
  const start = () => {
    const action = state.snapshot?.actions?.find(
      (item: any) => item.id === "changes-build",
    );
    if (action) void showAction(action);
  };
  return (
    <div className="enigma-changes">
      <div className="enigma-change-toolbar">
        <div
          className="enigma-view-tabs"
          role="tablist"
          aria-label="变更阅读方式"
          data-glass-segmented=""
        ><GlassSelection selection={view}/>
          {modes.map((key,index)=><button key={key} ref={node=>{tabs.current[key]=node;}} id={`${tabId}-${key}`} role="tab" aria-selected={view===key} aria-controls={`${tabId}-panel`} tabIndex={view===key?0:-1} data-tooltip={{diff:'逐文件查看固定版本的差异；未展开内容会明确标示',smart:'按意图、影响范围和源码证据阅读同一版本',files:'浏览当前文件；可能与冻结版本不同',maps:'按整个任务查看阅读路线、源码节点与需求覆盖'}[key]} onClick={()=>setView(key)} onKeyDown={event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();const next=modes[event.key==='Home'?0:event.key==='End'?modes.length-1:(index+(event.key==='ArrowRight'?1:modes.length-1))%modes.length];setView(next);tabs.current[next]?.focus();}}}>{{diff:'全量 diff',smart:'智能阅读',files:'项目文件',maps:'任务地图'}[key]}</button>)}
        </div>
        {(view==='diff'||view==='smart')&&<button className="enigma-primary" disabled={busy||readOnly} data-tooltip="选择暂存、提交或 MR 来源，为同一版本生成差异与智能阅读" onClick={start}>
          生成阅读
        </button>}
        <SurfaceMenu label="阅读工具">
            {(state.snapshot?.actions || [])
              .filter(
                (action: any) =>
                  action.group === "reading" && action.id !== "changes-build",
              )
              .map((action: any) => (
                <button key={action.id} data-tooltip={action.description} onClick={() => void showAction(action)}>
                  {action.title}
                  <small>{action.description}</small>
                </button>
              ))}
        </SurfaceMenu>
      </div>
      <div id={`${tabId}-panel`} role="tabpanel" aria-labelledby={`${tabId}-${view}`}>
      {view==='maps'?<TaskMaps/>:view === "files" ? (
        files
      ) : !record ? (
        <div className="enigma-welcome-card">
          <span className="enigma-feature-icon">⌘</span>
          <h3>把代码变更读成一条清楚的路线</h3>
          <p>
            暂存、提交或 MR 产生后，Agent 可以生成同版本的全量 diff
            和智能阅读。按职责与行为展开，也可直接核对每一处源码。
          </p>
          <button className="enigma-primary" disabled={busy||readOnly} onClick={start}>
            选择变更来源
          </button>
        </div>
      ) : (
        <>
          <div className="enigma-version-line">
            <span>
              {
                (
                  {
                    working: "工作区变更",
                    staged: "暂存变更",
                    commit: "提交变更",
                    "merge-request": "MR / PR 变更",
                  } as any
                )[record.input.kind]
              }
            </span>
            <span>{changes.length} 个文件</span>
            <span>版本 {record.version.slice(0, 10)}</span>
            <span data-current={publication.matchesWorkspace}>
              {publication.matchesWorkspace
                ? "与当前源码一致"
                : publication.sourceMatchesWorkspace===true ? '源码相同 · 环境或配置已变化' : "固定历史版本 · 工作区状态已变化"}
            </span>
          </div>
          {!!record.gaps?.length&&<p className="enigma-source-note">这份阅读有 {record.gaps.length} 项未展开或待核对内容，详见“跨仓关系与阅读缺口”。</p>}
          {record.status !== "ready" && (
            <div className="enigma-empty">
              {record.status === "reading"
                ? "正在生成有源码依据的阅读…"
                : record.error || "已保存全量 diff，智能阅读尚未完成"}
            </div>
          )}
          {view === "diff" ? (
            <div className="enigma-diff-layout">
              {changes.length>8&&<input className="enigma-timeline-search enigma-diff-filter" value={filter} aria-label="筛选变更文件" placeholder="按路径查找文件" onChange={e=>setFilter(e.target.value)}/>}
              <nav aria-label="变更文件">
                {!matching.length&&<p className="enigma-source-note">没有匹配的变更文件。</p>}
                {matching.map((item: any) => (
                  <button
                    key={`${item.repo}:${item.file}`}
                    data-active={file === item}
                    onClick={() => setSelected(`${item.repo}:${item.file}`)}
                  >
                    <span>
                      {item.change === "added"
                        ? "+"
                        : item.change === "deleted"
                          ? "−"
                          : "M"}
                    </span>
                    <div>
                      <strong>{item.file.split("/").pop()}</strong>
                      <small>
                        {item.repo} / {item.file}
                      </small>
                    </div>
                  </button>
                ))}
              </nav>
              {file && (
                <section className="enigma-diff-document">
                  <header>
                    <strong>
                      {file.repo} / {file.file}
                    </strong>
                    <small>此处显示保存版本，后续编辑不会改写它</small>
                  </header>
                  {clipped&&!fullPatch&&<><p className="enigma-source-note" role="status">这份差异先展示前 120,000 个字符，后续内容尚未展开。</p>{(!file.before||file.before.content!==undefined)&&(!file.after||file.after.content!==undefined)&&<button disabled={expanding} onClick={()=>void expand()}>{expanding?'正在展开完整差异…':'显示完整差异'}</button>}</>}
                  {expandError&&<p role="alert" className="enigma-error">{expandError}</p>}
                  {plainDiff&&<p className="enigma-source-note">长差异以可选择的纯文本显示，减少逐行渲染开销。</p>}
                  <pre>
                    {fullPatch || plainDiff ? shownPatch : (
                      file.patch ||
                      omission(file.after?.omitted || file.before?.omitted || '') ||
                      "只有文件模式发生变化"
                    )
                      .split("\n")
                      .map((line: string, index: number) => (
                        <span
                          key={index}
                          className={
                            line.startsWith("+")
                              ? "enigma-diff-add"
                              : line.startsWith("-")
                                ? "enigma-diff-delete"
                                : line.startsWith("@@")
                                  ? "enigma-diff-range"
                                  : ""
                          }
                        >
                          {line || " "} {"\n"}
                        </span>
                      ))}
                  </pre>
                </section>
              )}
            </div>
          ) : (
            reading && (
              <div className="enigma-smart-reading">
                <div className="enigma-reading-intro">
                  <h3>{record.input.goal}</h3>
                  <p>
                    先看这次行为变化，再沿源码关系阅读。说明是分析结果，验收仍以原检查为准。
                  </p>
                </div>
                {(reading.chapters || []).map((chapter: any, index: number) => (
                  <details
                    className="enigma-reading-chapter"
                    key={chapter.id}
                    open={index === 0}
                  >
                    <summary>
                      <span>{String(index + 1).padStart(2, "0")}</span>
                      <div>
                        <strong>{chapter.authority==='navigation-hint'?chapterLabels[chapter.title]||chapter.title:chapter.title}</strong>
                        <small>{chapter.nodes.length} 个源码锚点</small>
                      </div>
                      <span>⌄</span>
                    </summary>
                    <p>{chapter.authority==='navigation-hint'?'以下按静态源码职责分组；请沿锚点核对行为与影响。':chapter.summary}</p>
                    {chapter.nodes
                      .map((id: string) =>
                        reading.nodes.find((node: any) => node.id === id),
                      )
                      .filter(Boolean)
                      .map((node: any) => (
                        <details className="enigma-source-anchor" key={node.id}>
                          <summary>
                            <span>
                              {node.source.repo} / {node.source.file}:
                              {node.source.line}
                            </span>
                            <strong>{node.source.symbol}</strong>
                          </summary>
                          <pre>{node.source.snippet}</pre>
                          <button
                            onClick={() =>
                              openEngineering({
                                id: `file:${node.source.repo}:${node.source.file}`,
                                title: node.source.file.split("/").pop(),
                                group: "reading",
                                repo: node.source.repo,
                                file: node.source.file,
                              })
                            }
                          >
                            打开当前源码
                          </button>
                          <small>上方片段来自固定版本；当前源码可能不同</small>
                        </details>
                      ))}
                  </details>
                ))}
                {reading.insights?.length > 0 && (
                  <section>
                    <h3>变更解释与待核对项</h3>
                    {reading.insights.map((insight: any, index: number) => (
                      <article className="enigma-insight" key={index}>
                        <strong>{insight.title}</strong>
                        <p>{insight.text}</p>
                        <small>
                          {insight.anchors.length} 个来源 · 模型分析
                        </small>
                      </article>
                    ))}
                  </section>
                )}
                <details className="enigma-reading-chapter">
                  <summary>
                    <strong>跨仓关系与阅读缺口（{record.gaps.length}）</strong>
                  </summary>
                  {reading.architecture.map((item: any) => (
                    <p key={item.repo}>
                      <strong>{item.repo}</strong> ·{" "}
                      {item.responsibility || "职责待补充"}
                      {item.dependsOn.length
                        ? ` · 依赖 ${item.dependsOn.join("、")}`
                        : ""}
                    </p>
                  ))}
                  {record.gaps.map((gap: string, index: number) => (
                    <p key={index}>{omission(gap)}</p>
                  ))}
                </details>
              </div>
            )
          )}
        </>
      )}
      </div>
    </div>
  );
}
