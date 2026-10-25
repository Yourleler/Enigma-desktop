# 跨仓库契约与联合验收

`workspace_contracts` 结合带来源的人工映射和自动静态候选。当前自动分析 Python 函数路由装饰器、标准库 HTTP Handler 路径条件，以及 TS/JS 的静态 `fetch` 端点，按 method/path 生成可能的生产方与消费方关系。

端点一样不代表调用同一服务。自动关系始终为 candidate，运行时连接、基址、认证与序列化行为必须验收；未找到候选也不等于无依赖。

仓库可放一个 `.enigma-contracts.json`：

```json
{
  "schema": 1,
  "contracts": [
    {
      "id": "greeting",
      "method": "GET",
      "path": "/greet",
      "producer": { "repo": "server", "file": "server.py", "symbol": "do_GET" },
      "consumers": [{ "repo": "sdk", "file": "index.js", "symbol": "getGreeting" }],
      "checks": ["joint-http"]
    }
  ]
}
```

映射只能引用已注册仓库和真实文件/检查 ID。工具给出配置与源码 hash；契约调整使旧阅读证据失效。仓库图将声明的 consumer → producer 加入依赖关系，与 package.json 和用户配置的依赖一起分析顺序与反向影响。`confirmed` 在仓库图中表示声明存在，不表示运行时已通过。

真实模型验证入口：

```bash
npm run build
node scripts/gateway-cross-language.mjs /path/to/report-directory
```

这是显式真实模型调用，使用本机已经配置的 Gateway，生成独立临时三仓库和报告。模型自主读取 Python/JS 来源、查看契约、创建任务计划、修改生产方/SDK/应用，再运行三项语法检查和真实 Python HTTP 服务 → JS SDK → JS 应用检查。脚本不在普通 CI 调用，报告保存临时工作区供复查。

本轮 `gateway-gpt-6-1-sol` 完成该任务：Python 返回值改为 `data.message`，SDK 读取该字段，应用输出 `app:v2`；四项实际检查通过。共 18 次工具调用，一次计划更新被门禁拒绝后模型读取当前状态重试。单任务证明这条联调链可运行，不证明普遍任务成功率。
