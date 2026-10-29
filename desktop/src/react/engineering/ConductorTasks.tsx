import { switchSession } from "../stores/session-actions";
import { MarkdownContent } from "../components/chat/MarkdownContent";
import { renderMarkdown } from "../utils/markdown";
import { engineeringRequest, useEngineering, openEngineering,loadEngineeringTab } from "./state";
import {useSideAction} from './useSideAction';
import {composeTaskRequest} from './compose-task';
import {useSideQuery} from './useSideQuery';
import {displayTime} from './interaction-copy';

const statuses: Record<string, string> = {
  queued: "等待调度",
  creating: "正在准备工作区",
  running: "执行中",
  completed: "执行已结束",
  failed: "执行失败",
  cancelled: "已取消",
  blocked: "需要处理阻塞",
};
export function ConductorTasks({ value: initial }: { value: any }) {
  const sessionPath = useEngineering((state) => state.sessionPath),action=useSideAction(sessionPath);
  const manager=useEngineering(state=>state.snapshot?.kind==='manager');
  const query=useSideQuery<any>('/data/conductor',sessionPath,manager),value=query.data||initial;
  const stop=useSideAction(sessionPath);
  const cancel=(id:string)=>stop.run(id,()=>engineeringRequest('/conductor/cancel',sessionPath,{id}),()=>{const current=useEngineering.getState(),tab=current.tabs.find(tab=>tab.id===current.active);if(tab?.group==='conductor')return loadEngineeringTab(tab);});
  const report = () => action.run('report',()=>engineeringRequest('/conductor/report',sessionPath,{}),artifact=>{
      openEngineering({
        id: `artifact:${artifact.id}`,
        group: "artifacts",
        artifact: artifact.id,
        title: artifact.title,
      });
  });
  return (
    <>
      <div className="enigma-reading-intro">
        <h3>任务编排管家</h3>
        <p>
          向管家交代目标和允许范围，它会组织项目、工作对话和模型，跟踪结果并协调问题。
        </p>
      </div>
      {manager&&<p className="enigma-source-note">每 5 秒更新任务、用量和验收状态。{query.receivedAt>0&&` 最近读取：${displayTime(query.receivedAt)}`}</p>}
      {query.error&&<p className="enigma-error" role="status">任务状态更新失败，以下为最近记录。<button onClick={()=>void query.refresh()}>重新读取任务状态</button></p>}
      <div className="enigma-stat-grid">
        {[
          ["工作对话", value.tasks.length],
          ["同时运行", value.active],
          ["待协调冲突", value.conflicts.length],
        ].map(([label, count]) => (
          <div key={String(label)}>
            <strong>{count}</strong>
            <span>{label}</span>
          </div>
        ))}
      </div>
      <p className="enigma-source-note">
        {value.acceptance?.valid && value.acceptance.status === "verified"
          ? "当前版本的原联合检查已通过；其他目标要求仍须核对。"
          : value.acceptance
            ? "原联合检查尚未通过或证据已过期。"
            : "原联合检查尚未执行。"}
        工作对话执行结束后，可让管家预览并选择成果，再做整体验收。
      </p>
      {value.projects.length > 0 && (
        <div className="enigma-chips">
          {value.projects.map((project: any) => (
            <span key={project.id}>项目 · {project.name}</span>
          ))}
        </div>
      )}
      {value.tasks.map((task: any) => (
        <article className="enigma-step" key={task.id}>
          <span>
            {task.executionActive || task.status === "running"
              ? "◌"
              : task.status === "completed"
                ? "✓"
                : "○"}
          </span>
          <div>
            <strong>{task.title}</strong>
            <p>{task.goal}</p>
            {task.requires?.length>0&&<p className="enigma-source-note">前置任务：{task.requires.map((id:string)=>value.tasks.find((item:any)=>item.id===id)?.title||id).join('、')}。开始时会带入前置任务的固定代码成果。</p>}
            {task.inputVersions?.length>0&&<p className="enigma-source-note">已带入 {task.inputVersions.length} 个前置文件版本。整合这项成果前，需先选择相应上游成果。</p>}
            <div className="enigma-chips">
              <span>{task.executionActive&&task.status==='cancelled'?'已请求停止，正在收尾':task.executionActive&&task.status==='completed'?'工作对话仍有执行':task.waitingOnDependencies?'前置任务未完成':statuses[task.status] || "状态待核对"}</span>
              <span>
                {task.writeRepos.length
                  ? `可写 ${task.writeRepos.join("、")}`
                  : "只读任务"}
              </span>
              <span>
                {task.progress?.verification === "verified"
                  ? "原检查已通过"
                  : task.progress?.verification === 'stale'
                  ? '原检查需要重新验证'
                  : "验收仍需核对"}
              </span>
            </div>
            {Number.isSafeInteger(task.progress?.requests)&&<p className="enigma-source-note">累计模型请求 {task.progress.requests} 次 · 中断与接续保留累计值</p>}
            {task.progressError&&<p className="enigma-error">{task.progressError}</p>}
            {task.observation?.available && (
              <p className="enigma-source-note">
                {task.observation.lastProgress
                  ? `最近证据：${task.observation.lastProgress.reference || task.observation.lastProgress.stage}`
                  : "尚未取得新的源码或检查证据"}
              </p>
            )}
            {task.result && (
              <details className="enigma-result">
                <summary>查看结果与依据</summary>
                <MarkdownContent html={renderMarkdown(task.result)} />
              </details>
            )}
            {task.error && <p className="enigma-error">{task.error}</p>}
            {task.sessionPath && (
              <button onClick={() => void switchSession(task.sessionPath)}>
                打开工作对话
              </button>
            )}
            <div className="enigma-inline-actions">
              {(task.executionActive||['queued','creating','running'].includes(task.status))&&<button disabled={!!stop.busy} data-tooltip="停止这项工作对话，保留已完成的文件；其他任务继续" onClick={()=>void cancel(task.id)}>{stop.busy===task.id?'正在停止…':'停止此任务'}</button>}
              {task.status==='completed'&&!task.executionActive&&<button data-tooltip="把预览要求加入当前管家的输入框，由你确认发送" onClick={()=>composeTaskRequest(`请预览工作任务「${task.title}」（${task.id}）的成果，说明实际变化、前置输入是否已整合、与当前父代码是否冲突。先给出预览和依据，再由我选择是否整合。`)}>让管家预览成果</button>}
              {['blocked','failed','cancelled'].includes(task.status)&&!task.executionActive&&<button data-tooltip="把接续核对要求加入输入框，不会立即重启任务" onClick={()=>composeTaskRequest(`请核对工作任务「${task.title}」（${task.id}）停止或阻塞的原因、原要求、实际文件和已发生效果，提出接续方案。保留原检查与当前权限，结果不明确的操作先核对，不直接重放。`)}>让管家核对接续</button>}
            </div>
          </div>
        </article>
      ))}
      {!value.tasks.length && (
        <div className="enigma-welcome-card">
          <h3>把一项目标交给管家</h3>
          <p>
            可以安排独立验证、比较方案、代码与文档协作，或交代其他目标。管家会在你允许的范围内组织任务。
          </p>
        </div>
      )}
      {value.tasks.length > 0 && (
        <button
          className="enigma-primary"
          onClick={() => void report()}
          disabled={!!action.busy}
        >
          {action.busy ? "正在保存工作报告…" : "汇总为工作报告"}
        </button>
      )}
      {action.error && <p className="enigma-error" role="alert">{action.error}</p>}
      {stop.error&&<p className="enigma-error" role="alert">{stop.error}</p>}
      <details className="enigma-result">
        <summary>协调记录与待处理冲突</summary>
        {value.conflicts.map((conflict: any, index: number) => (
          <p key={index}>
            {conflict.repo} / {conflict.file}{" "}
            在两个工作对话中产生了不同结果，需要核对后选择。
          </p>
        ))}
        {value.events.map((event: any, index: number) => (
          <p key={index}>
            <small>{event.at}</small> · {event.text}
          </p>
        ))}
      </details>
    </>
  );
}
