# 按需独立审查

审查命令仅由用户触发，不自动在每个回合运行。它使用新的 Pi 会话和独立的资源发现根，传入任务目标、选定要求、两端版本、增量 diff 和有效/失效检查来源。

```bash
enigma-next review BASELINE_ID '审查本次跨仓库接口迁移是否保持应用行为'
```

在 Pi 中用 `/enigma-review JSON`：

```json
{
  "baseline": "CHECKPOINT_ID",
  "goal": "保持 SDK 返回消息字符串",
  "requirements": ["ORIGINAL_USER_ENTRY_ID"],
  "evidence": ["CHECK_EVIDENCE_ID"]
}
```

核心先保存当前目标快照，比较指定基线，仅传当前增量。模型工具只有 `review_read`，它从 hash 校验的目标 blob 读取有界源码，不运行 shell、不写代码，不把主会话所有材料或提示词复制进去。审查独立目录不等于 OS 沙箱；配置中的可信 provider 与宿主仍有其运行权限。

源码在审查期间变化，报告为 stale；取消/超时/模型错误不能成为完成审查。报告关联基线、目标、模型、独立会话和已有检查来源，保存在 `.enigma-next/reviews/<id>/report.json`。完成审查意味着产生了模型意见，不等于测试通过或意见全部正确；实际验收保持独立。

当前最多传 80 项变更，超出部分注明遗漏；大 diff 和复杂运行行为要分次、扩大覆盖或运行检查。目标要优先读取生产方与消费方，报告指出位置、违反目标的原因和修正建议；未确认疑点需要明确说明。

受控测试覆盖冻结源码、限制工具、独立上下文、外部修改导致 stale 和派发前取消。真实 Gateway 已发现一个刻意注入的跨语言缺陷：Python 将 `message` 移至 `data.message`，JS SDK 仍读取顶层字段，应用因此收到 undefined；审查指出具体位置及 SDK 修正，未改源码或声称运行测试。

复验入口 `node scripts/gateway-review-probe.mjs /path/to/reports`。一项已知缺陷案例不代表普遍审查精确率或召回率。
