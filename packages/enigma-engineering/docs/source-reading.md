# 有依据的代码阅读

TS/JS 阅读先用 `rg` 定位查询词，再在已注册源码集合中建立有界 TypeScript program。使用 compiler checker 解析实际静态符号，导入别名、重导出和项目路径配置；返回定义、调用位置、所属函数、源码内容 hash 和静态目标。

`code_trace` / `read SYMBOL [REPO]` 返回可以展开的 `map.nodes` 与 `map.edges`，每个节点保留代码位置和片段。`repo` 限定要追踪的源符号所在仓库，调用方仍可来自其他已注册仓库。同名局部参数与上游函数的静态符号不同。

TypeScript API 的确定绑定只是静态事实；`confirmed` 不意味着运行时动态分发已验证。外部包的未加载声明、生成文件、动态 import、未注册的配置继承和无法解析的关系需要继续检查。不可解析关系通过 diagnostics/未解析导入表达，不捏造调用链。

解析缓存使用原始字节 SHA-256；复读不变文件重用 AST，变化文件重新解析。每份结果列出来源文件 hash，证据保存时和使用时重新核对；旧结果不会因保存时间较晚而变成新版本。缓存只在进程内保存，不替代持久阅读证据。

`code_trace` 和 CLI `read` 原子发布版本化阅读地图。`reading_open` 或 `reading-open SYMBOL [NODE_ID]` 可查看上一版，或把节点展开到实际源码；返回当前来源是否与发布版本一致。新分析运行/失败/取消时不提前删除旧结果，旧版本明确标为失效；不能把旧结论作为新代码事实。

默认最多 160 个源码文件，可提高到 1000；单文件 512 KB、分析内容合计 16 MB。默认最多 60 个结果。达到限制明确标 truncated；未注册和排除路径不会进入 compiler 文件系统。此实现不调用项目编译插件，也不执行源码。

Python 阅读使用独立进程中的标准库 `ast.parse`，经 stdin 传入已核对的文本；以 `-I` 隔离启动，不 import 或执行仓库源码。支持函数/类定义、导入别名、调用候选、明确模块来源以及常见路由声明。同名局部参数遮蔽导入时不会把调用确认到上游函数。读取缓存按实际文件 hash 重用；语法错误或解析器不可用通过 diagnostics 表达。

Python 解释器默认 `python3`（Windows 为 `python`），可由 `ENIGMA_PYTHON` 明确指定。源码使用 UTF-8；自定义 import hooks、运行时替换、闭包/类动态派发和大型外部包没有完整解析，保持候选或未知。取消解析会清理子进程，不执行代码的副作用。

`workspace_contracts` / `contracts [QUERY]` 查找 Python 路由与 TS/JS `fetch` 的端点匹配，并返回源码位置与版本。相同 path/method 只说明静态候选；基址、路由是否启用、认证和运行行为要通过实际检查。明确契约映射可在仓库 `.enigma-contracts.json` 声明生产方、消费方与检查 ID，关系进入仓库依赖/影响图。

这不是完整多语言运行时调用图。跨语言真实 HTTP 案例已验证，但更多协议、语言和复杂模块边界仍需逐项接入。

实现依据：[TypeScript Compiler API](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API)。具体实现和数据模型见本仓阅读器。

Python 实现依据：[标准库 AST 文档](https://docs.python.org/3/library/ast.html)。

## 项目工作台开发分支的增强

`codex/project-workbench` 新增 Go/gopls 静态定义、引用、实现与调用查询，可重建文件导航索引，以及依赖现有证据保鲜的跨进程阅读复用。项目资料和按任务/diff 组织的阅读入口见 [使用说明](project-workbench.md)。它们属于新增轮次，不能用 0.2.0 的验收结论替代本轮真实验证，也不承诺完整动态架构图。
