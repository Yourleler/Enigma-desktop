import { useEngineering, openEngineering,showAction,runDocumentExample } from "./state";
import {explainEvidenceProblem} from './interaction-copy';
import {useSideAction} from './useSideAction';
import {useStore} from '../stores';
export function DocumentsPanel({ value }: { value: any }) {
  const snapshot=useEngineering(s=>s.snapshot),register=snapshot?.actions?.find((a:any)=>a.id==='document-register');
  const sessionPath = useEngineering((state) => state.sessionPath), actionState=useSideAction(sessionPath);
  const readOnly=useStore(s=>s.sessionPermissionMode==='read_only');
  const busy=!!actionState.busy||snapshot?.state?.idle===false||snapshot?.state?.operation?.state==='running';
  const execute = (document: string, example: string) => actionState.run(`${document}/${example}`,()=>runDocumentExample(document,example));
  return (
    <>
      <h3>文档维护与示例</h3>
      <p>
        查看文档的源码依据、需更新的段落和示例运行结果。可以在对话中让助手编写并登记文档，再从这里核对。
      </p>
      {register&&<button className="enigma-primary" disabled={readOnly||busy} onClick={()=>void showAction(register)}>登记已有文档</button>}
      {value.items.map((item: any) => (
        <article className="enigma-welcome-card" key={item.record.id}>
          <h3>{item.record.title}</h3>
          <button
            data-tooltip={`查看 ${item.record.repo} / ${item.record.file}`}
            onClick={() =>
              openEngineering({
                id: `file:${item.record.repo}:${item.record.file}`,
                group: "documents",
                repo: item.record.repo,
                file: item.record.file,
                title: item.record.file,
              })
            }
          >
            打开文档
          </button>
          <p>
            {item.current ? "文档版本当前有效" : "文档已有更新，需要重新登记"}
          </p>
          {item.claims.map((claim: any) => (
            <p key={claim.id}>
              <strong>{claim.section}</strong> ·{" "}
              {claim.current ? "来源当前有效" : "需要核对来源"}
              <br />
              {claim.text}
              <br />
              <small>
                {claim.authority === "source"
                  ? "源码支持"
                  : claim.authority === "user-decision"
                    ? "用户决定"
                    : claim.authority === "inference"
                      ? "推断"
                      : "尚未验证"}{" "}
                · {claim.problems.map(explainEvidenceProblem).join("；")}
              </small>
            </p>
          ))}
          {item.examples.map((example: any) => (
            <div key={example.id}>
              <p>
                {example.section} ·{" "}
                {example.valid ? "本版本实际运行通过" : "尚无当前有效运行证据"}
              </p>
              <button
                disabled={readOnly||busy||!item.current||!snapshot?.actions?.some((action:any)=>action.id==='document-example')}
                data-tooltip={readOnly ? '当前对话只读，不能运行命令' : !item.current ? '文档已变化，请重新登记当前示例' : busy ? '当前任务正在运行，可以从上方停止或查看进度' : '先核对已登记的命令，再实际验证文档预期'}
                onClick={() => void execute(item.record.id, example.id)}
              >
                {actionState.busy === `${item.record.id}/${example.id}`
                  ? "正在提交…"
                  : `验证示例 ${example.id}`}
              </button>
              <details className="enigma-result"><summary>查看命令与最近结果</summary><pre>{example.argv.join('\n')}</pre><p>运行仓库：{example.repo} · 预期输出：{example.expected}</p>{example.receipt&&<><p>最近运行：{example.receipt.status==='passed'?'通过':example.receipt.status==='timeout'?'超时':example.receipt.status==='cancelled'?'已取消':'未通过'}</p><pre>{example.receipt.output}</pre></>}</details>
            </div>
          ))}
        </article>
      ))}
      {value.consistency.conflicts.map((conflict: any) => (
        <p className="enigma-error" key={conflict.key}>
          同版本说明冲突：{conflict.key}
        </p>
      ))}
      {!value.items.length && (
        <p>
          尚未登记文档声明。可以让 Agent
          编写迁移指南，登记源码依据和可执行例子，再独立照文档核对。
        </p>
      )}
      {readOnly&&<p className="enigma-source-note">当前对话只读，可以查阅文档和已有验证结果。</p>}
      {actionState.error && <p className="enigma-error" role="alert">{actionState.error}</p>}
    </>
  );
}
