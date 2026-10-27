import { FormSelect } from './FormSelect';
import { useEffect, useState } from "react";
import { engineeringRequest, useEngineering } from "./state";
import { MarkdownContent } from "../components/chat/MarkdownContent";
import { renderMarkdown } from "../utils/markdown";
import {useSideQuery} from './useSideQuery';
import { useSideAction } from './useSideAction';

const phases: Record<string, string> = {
  watching: "持续观察",
  diagnosing: "独立诊断中",
  intervening: "正在处理",
  "waiting-user": "等待接管",
  "host-unavailable": "宿主未响应",
  stopped: "已停止",
};
export function GuardianPanel() {
  const sessionPath = useEngineering((state) => state.sessionPath),
    [question, setQuestion] = useState(""),
    [answer, setAnswer] = useState<{question:string;text:string;usedModel:boolean}|null>(null),
    [notice, setNotice] = useState(''),
    [mode, setMode] = useState("assist"),
    [actions, setActions] = useState(["notify"]),
    [budget, setBudget] = useState(3);
  const query=useSideQuery<any>('/guardian/status',sessionPath),status=query.data,refresh=query.refresh;
  const connection=useEngineering(s=>s.connectionId);
  const control=useSideAction(sessionPath),diagnosis=useSideAction(sessionPath),stopStart=useSideAction(sessionPath);
  useEffect(()=>{setQuestion('');setAnswer(null);setNotice('');setMode('assist');setActions(['notify']);setBudget(3);},[sessionPath,connection]);
  const perform = (action: string) => {
    if(action==='ask')return diagnosis.run('ask',()=>engineeringRequest('/guardian/diagnose',sessionPath,{question}),result=>setAnswer({question,text:result.answer,usedModel:result.usedModel===true}));
    return control.run(action,()=>action==='start' ? engineeringRequest("/guardian/start", sessionPath, {
          config: {
            mode,
            stageDeadlineMs: 60000,
            maxInterventions: mode === "managed" ? budget : 0,
            allowedActions: actions,
          },
        }) : engineeringRequest('/guardian/stop',sessionPath,{}),()=>{setNotice(action==='start'?'独立观察已启动':'独立观察已停止，主任务继续运行');return refresh();});
  };
  const processLost=status && ['gone','changed'].includes(status.processState);
  const running = status && status.phase !== "stopped" && !processLost && !!status.pid;
  return (
    <section className="enigma-welcome-card enigma-guardian">
      <h3>独立管家</h3>
      <p>
        单独的进程持续观察运行状况。你也可以随时问它任务有没有有效进展、在等什么，或应该怎样排障。
      </p>
      <div className="enigma-chips">
        <span>
          {query.loading && !status ? "正在读取状态" : query.error ? "连接中断，状态待核对" : processLost ? '观察进程已退出' : status?.phase==='host-unavailable' ? '观察需要恢复' : running ? phases[status.phase] || "状态待核对" : status?.phase==='stopped' ? '已停止观察' : "尚未启动"}
        </span>
      </div>
      {(processLost||status?.phase==='host-unavailable')&&<p className="enigma-source-note">上一次观察没有正常连接到当前宿主。原任务和文件保留，可以核对下方记录后重新启动。</p>}
      {!running && (
        <>
          <FormSelect label="管家方式" value={mode} onChange={setMode} options={[{value:'assist',label:'观察并给建议'},{value:'managed',label:'按允许范围托管'}]} />
          {mode === "managed" && (
            <>
              <p>
                发现明确问题时，可以执行下面允许的动作。单纯耗时长不会触发代码回退。
              </p>
              {[
                ["notify", "记录并提醒"],
                ["cancel-and-resume", "结束旧执行后调整路线接续"],
                ["refresh-observer", "重建空闲会话的观测采集"],
                ["propose-repair", "安排隔离复现与维修任务"],
              ].map(([id, label]) => (
                <label className="enigma-check" key={id}>
                  <input
                    type="checkbox"
                    checked={actions.includes(id)}
                    onChange={(event) =>
                      setActions(
                        event.target.checked
                          ? [...actions, id]
                          : actions.filter((action) => action !== id),
                      )
                    }
                  />
                  {label}
                </label>
              ))}
              <label className="enigma-field">
                <span>自动处理次数上限</span>
                <input
                  type="number"
                  value={budget}
                  min={1}
                  max={10}
                  onChange={(event) => setBudget(Number(event.target.value))}
                />
              </label>
            </>
          )}
        </>
      )}
      <button
        disabled={!!control.busy || !status && (query.loading || !!query.error) || !running && mode==='managed' && (!actions.length || !Number.isInteger(budget) || budget<1 || budget>10)}
        data-tooltip={control.busy ? '正在处理观察进程，请稍候' : running ? '停止独立观察进程，主任务继续运行' : '启动独立进程观察主任务，按选定范围提供建议或处理问题'}
        onClick={() => void perform(running ? "stop" : "start")}
      >
        {control.busy ? control.busy==='start' ? '正在启动观察…' : '正在停止观察…' : running ? "停止独立观察" : "启动独立观察"}
      </button>
      {control.busy==='start'&&<button disabled={!!stopStart.busy} onClick={()=>void stopStart.run('stop',()=>engineeringRequest('/guardian/stop',sessionPath,{}),()=>refresh())}>{stopStart.busy?'正在取消启动…':'取消启动观察'}</button>}
      {!running&&mode==='managed'&&(!actions.length||!Number.isInteger(budget)||budget<1||budget>10)&&<p className="enigma-source-note">托管需至少允许一种动作，并设置 1–10 次处理上限；只想了解状态可选择“观察并给建议”。</p>}
      <label className="enigma-field">
        <span>想了解当前任务的什么情况？</span>
        <textarea
          value={question}
          maxLength={1500}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="例如：这轮验证是否有有效进展，下一步该核对哪里？"
        />
      </label>
      <button
        disabled={!!diagnosis.busy || !question.trim()}
        data-tooltip={diagnosis.busy ? '诊断正在处理，请稍候' : !question.trim() ? '请先输入想了解的运行状态问题' : '单独调用模型分析运行证据，不中断主对话；会使用模型用量'}
        onClick={() => void perform("ask")}
      >
        {diagnosis.busy ? "正在分析运行证据…" : "询问运行状态"}
      </button>
      <p className="enigma-source-note">不必启动持续观察也能提问。回答依据已采集的记录，会调用一次独立诊断流程。</p>
      {answer && (
        <div className="enigma-result">
          <p className="enigma-source-note">问题：{answer.question}</p>
          {!answer.usedModel&&<p className="enigma-source-note">诊断模型暂不可用，以下是已采集的运行记录摘要。</p>}
          <MarkdownContent html={renderMarkdown(answer.text)} />
        </div>
      )}
      {status?.diagnosis && !answer && <p>{status.diagnosis.answer}</p>}
      {status?.events?.length > 0 && (
        <details className="enigma-result">
          <summary>观察与接管记录</summary>
          {status.events.slice(-10).map((event: any, index: number) => (
            <p key={index}>{event.text}</p>
          ))}
        </details>
      )}
      {control.error && <p className="enigma-error" role="alert">{control.error}</p>}
      {notice&&<p className="enigma-source-note" role="status">{notice}</p>}
      {stopStart.error && <p className="enigma-error" role="alert">{stopStart.error}</p>}
      {diagnosis.error && <p className="enigma-error" role="alert">{diagnosis.error}</p>}
      {query.error&&<p className="enigma-error">{query.error}</p>}
    </section>
  );
}
