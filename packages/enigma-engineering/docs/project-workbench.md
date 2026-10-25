# 项目工作台：代码与项目资料

本页描述源码阅读与项目资料，环境、交付、协作和本地界面已共用领域层。完整范围和证据见 [实施计划](workbench-plan.md)与[逐项验收](acceptance-0.3.0.md)，单项阅读结果不能替代工程流程验收。

## Go 语义阅读

安装受验证的工具后，现有 `read` / `code_trace` 入口可以读取 Go：

```bash
# 安装/编译 gopls 0.23 需要 Go 1.26+；CI 固定为 Go 1.26.10。
go install golang.org/x/tools/gopls@v0.23.0
enigma-next read Greet library
```

CI 用 Go 1.26.10 编译并验证 gopls 0.23.0。本机现成的 gopls 0.23.0 使用 Go 1.26.4 编译，配合 Go 1.25.12 完成了本地阅读与实际程序验证；安装要求与现成二进制运行分别核对。`ENIGMA_GOPLS` 可指定已有二进制。阅读临时为注册的顶层 Go 模块建立独立 go.work，查询定义、引用、实现关系和静态调用。使用只读模块模式、禁用 CGO/自定义 GOFLAGS 与 GOENV、网络依赖下载和自动工具链下载，不运行包的 init、程序或项目脚本。语言服务器交互有总时间预算与取消清理；无法加载的模块、外部声明和动态调用保留缺口。嵌套模块、不同 build tags 和运行时调用仍需继续扩展并用实际任务验证。

## 持久阅读与导航

```bash
enigma-next source-index Greet Go
enigma-next read Greet library
enigma-next reading-open Greet NODE_ID
```

导航索引是可重建的文件/词法候选，不冒充语义绑定。查询的版本化语义阅读可以跨进程重用，但必须重新核对源码、配置、环境及对应原始证据。阅读器代码、TypeScript/Node 版本，以及 Go 工具版本和有效构建配置也进入版本核对；升级后不继续沿用旧分析。代码变化使旧版本失效；取消刷新保留旧阅读和取消状态。TS/JS 的有限文件预算优先用于实际静态导入/重导出依赖；未读部分仍报告截断。

## 项目资料

```bash
enigma-next project add '{"title":"接口设计","source":{"kind":"file","repo":"library","file":"docs/api.md"}}'
enigma-next project list '接口迁移'
enigma-next project read RESOURCE_ID
enigma-next project bundle '接口迁移'
enigma-next project refresh RESOURCE_ID
enigma-next project remove RESOURCE_ID
```

资料是带来源的参考材料，不能替代用户指令或自动成为个人偏好。文件来源必须属于注册仓库；导入网页或文档正文使用 `source.kind=imported`、原 URL 和实际获取的 `content`，其远端保鲜状态仍为未核实。`source.kind=note` 需要明确 author 和 content。资料允许项目共享或通过 task 标识隔离。更新生成新修订，旧修订可查看；删除后旧修订不能重新进入当前上下文。

## 任务地图与需求覆盖

```bash
enigma-next task-map build '{"goal":"三仓库接口迁移","queries":[{"symbol":"Greet","repo":"library"}],"expectedRepos":["library","sdk","app"],"requirements":[{"id":"response","text":"应用返回新接口结果","checks":["joint-http"]}]}'
enigma-next task-map open TASK_READING_ID
enigma-next task-map coverage TASK_READING_ID CHECK_EVIDENCE_ID
```

也可传入 `baseline` 检查点和 `resources` 资料标识，以实际 diff 提取查询候选。图节点与边来自静态阅读，读取顺序和文件分类是导航建议；职责来自仓库声明。相关变更仅在实际静态关系连接时聚合。明确 `expectedRepos` 或 `expectedFiles` 后，范围外变更单列待核对；没有明确范围时不根据一句 goal 猜测哪些修改“不该做”。

通过 `annotate` 给讲解、风险和需求判断引用已发布的节点：不存在的节点、过期源码和旧修订拒绝写入。判断明确标为模型推断。`coverage` 分别返回需求判断与关联检查的实际通过情况；检查通过不能证明所有业务要求完整。

Pi 包新增独立 `pi-project` 扩展。便捷 `agent` 启动器会加载它；公开工具为 `source_index`、`project_context`、`task_reading`，与原生工具和其他扩展共存。宿主仍由 Pi 负责。

## 契约与来源获取

`schemas [QUERY]` / `schema_reading` 静态解析 Thrift、Protobuf 与 JSON Schema，返回声明、字段位置、导入和作用域内类型关系。它不运行生成器或项目代码；跨语言生成消费者与实际兼容性通过 `.enigma-contracts.json` 的源码映射及检查确认。声明的 `kind` 默认 `http`，也支持 `schema` 和 `configuration`（这两种需要 `name`，不要求虚构 HTTP path/method）。这些来源同时进入任务地图与阅读证据。

任务地图的 `chapters` 和 `layers` 可按实际节点做业务章节和职责分组。默认分组是导航建议，模型给出的名称和讲解标为推断；遗漏的节点仍保留在完整地图并列为缺口。

```bash
enigma-next schemas Message
enigma-next project fetch 'https://example.com/design' '{"title":"项目设计"}'
enigma-next project fetch 'https://example.larkoffice.com/docx/TOKEN' '{"scope":"keyword","keyword":"接口|验收"}'
enigma-next project refresh-source RESOURCE_ID
enigma-next project raw RESOURCE_ID
```

飞书复用已安装 `lark-cli docs +fetch --as user`，默认先读目录；选择器与文档修订一起保存。局部片段不是全文，完整响应及评论/引用 sidecar 保留在本地来源缓存。HTTP 文档保留原 URI、重定向终点、获取时间与 ETag，HTML 转为 Markdown；不会下载内嵌媒体。导入内容始终是参考材料，`current=null` 表示没有在每次读取时再次核实远端版本。

HTTP 私有/本机地址需要操作者显式登记 `project trust-host HOST`；Agent 工具不能自行扩大信任列表。重定向逐跳核对，DNS 地址用于固定该次连接。取消、文本预算和超时有明确失败结果。
