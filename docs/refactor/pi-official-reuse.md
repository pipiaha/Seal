# 官方 Pi SDK 复用矩阵（钉选 0.87.1）

本页记录 BeefTV 内置助手宿主对 `@earendil-works/pi-coding-agent@0.87.1` 的取舍。实现以本仓库 `agent-host/` 与钉选包内声明、示例、文档为准；`pi.dev` 最新文档可能对应更高版本。

测试版本：`@earendil-works/pi-coding-agent@0.87.1`（未升级；撰写时 npm latest 为 0.99.2）。

## 官方来源

当前宿主复用 `ProviderConfigInput.models[].reasoning / thinkingLevelMap / compat` 与官方 `AgentSession.setThinkingLevel()` 传递模型思考设置，不自建请求循环。默认单次输出49152，模型配置可限额；SDK按剩余上下文压缩实际额度。纯思考 `stopReason=length` 最多通过同一官方会话续接一次，保持原工具记录、预算与截止时间；部分代码、取消、待审批和等待任务不自动续接。正常 resolve 不代表制作完成，length、上游 aborted 与错误均投影真实未完成原因。

| 来源 | URL / 路径 |
| --- | --- |
| 公开 SDK 文档（可能新于钉选） | https://pi.dev/docs/latest/sdk |
| 公开事件流说明 | https://pi.dev/docs/latest/json |
| 公开设置参考 | https://pi.dev/docs/latest/settings |
| 仓库 | https://github.com/earendil-works/pi |
| 钉选 SDK 文档 | `node_modules/@earendil-works/pi-coding-agent/docs/sdk.md` |
| 钉选事件语义 | `node_modules/@earendil-works/pi-coding-agent/docs/json.md` |
| 钉选设置默认值 | `node_modules/@earendil-works/pi-coding-agent/docs/settings.md` |
| 全控装配示例 | `examples/sdk/12-full-control.ts` |
| 会话替换示例 | `examples/sdk/13-session-runtime.ts` |
| 设置示例 | `examples/sdk/10-settings.ts` |
| 会话持久化示例 | `examples/sdk/11-sessions.ts` |

## 复用矩阵

| 官方能力 | 决定 | 说明 |
| --- | --- | --- |
| `SessionManager` JSONL v3 | 采用 | 唯一 transcript。画布轮次写 `beeftv.canvas.turn` / `.started` custom entry，不另建聊天库。 |
| `createAgentSession` | 采用 | 每条画布会话的工厂：`noTools: "builtin"` + `customTools` + 全控 `resourceLoader`。 |
| `AgentSession.prompt` / `abort` / `subscribe` / `dispose` | 采用 | `prompt({ expandPromptTemplates: false, source: "rpc" })`。替换前 `await abort()` 再 `dispose()`，与 Runtime `teardownCurrent` 相同。 |
| `AgentSessionRuntime` | 不采用 | 官方 factory 面向 cwd 发现服务；`switchSession` 用 `SessionManager.open(path, undefined)`，会丢掉本宿主按画布编码的 `sessionDir`。画布级 `customTools` 仍要重绑。显式 dispose 更短且正确。 |
| `SettingsManager.inMemory` | 采用并显式钉值 | 压缩 `enabled/16384/20000`，重试 `3/2000/60000`，`provider.maxRetries=0`。不提高这些上限。`cacheWarming: "off"`，避免官方默认 streaming 额外打模型。 |
| 全控 `ResourceLoader` + `createExtensionRuntime` | 采用 | Skills 由 Go 按用户生成的不可变轮次快照提供；SDK `loadSkills` 显式读取可信入口，`includeDefaults: false`。prompts/themes/AGENTS 为空，不读 cwd 祖先。 |
| `noTools: "builtin"` + `customTools` | 采用 | 不暴露 read/bash/edit/write 等内置工具。 |
| `AgentSession.reload()` | 采用 | 仅在两轮对话之间刷新 Skill 清单；保留 SessionManager 与聊天历史。自定义 `read` 仅允许当前快照中的技能文件，不提供通用磁盘读取或 shell。 |
| `message_end` | 采用 | 本轮助手正文的权威来源。 |
| `agent_settled` | 采用 | 自动工作结束。宿主 `turn_end` 只在 prompt 返回且观察到 settled（或 prompt 抛错）后发出。 |
| `agent_end` | 不当前终态 | `willRetry` 时后面还有压缩恢复或重试。不映射成 `turn_end`。 |
| `compaction_*` / `auto_retry_*` | 转发 | 经现有 NDJSON 的 `lifecycle` 行到 React；面板只显示用户语。 |
| `tool_execution_start/update/end` | 转发并收敛 | NDJSON `tool` 行包含调用 ID、工具名、阶段、结束时的 `isError` 和可选 `detail` 展示副本。输入参数与文本结果过滤凭据并各限长 6000 字符，写入正文仅记字数，图片／二进制省略。完整 args、partialResult、result 不直接转发。更新事件每次调用只保留首次；重复更新不制造百分比或额外渲染。 |
| `DefaultResourceLoader` | 不采用 | 会发现 AGENTS/skills/shell。 |
| 官方 TUI / RPC 实验服务器 | 不采用 | 产品 UI 是 React + Go 代理。 |
| `@earendil-works/pi-web-ui` | 不采用 | 钉选时代的包是过期 Lit + IndexedDB，且会在浏览器里跑 Agent。 |

## 宿主内部分工

### 助手流式界面与工具记录

- 文字模型缺省允许图片输入，前端能力编辑器、模型目录默认值及助手 Provider 均为 8 张、每张 4 MiB。未填写参数的已有模型采用相同默认值；Provider 用可空字段区分缺省与显式 0，数量或大小设为 0 时继续关闭图片输入。只改变默认配置，不推断供应商真实视觉能力；图片请求是否被上游接受仍由实际接口决定。模型目录包、前端默认／关闭专项和桌面构建通过，未调用真实模型。

- 参考 [Codex App Server 的历史读取与运行事件](https://learn.chatgpt.com/docs/app-server)，页面重进时先恢复已有过程，再继续接收当前任务的更新；Seal 沿用自己的 Pi 会话与历史刷新协议，没有引入 Codex Runtime。`activeTurn` 返回观察器的正文／工具快照和生命周期状态，恢复页每 2.5 秒刷新，在最终轮次保存后转为折叠历史。应用中断时，从原有 SDK 消息与工具检查点重建已保存过程，未收到完成证据的调用保持中断状态。
- 默认每轮模型请求和工具步数额度为 0（不限制次数）；可显式设置正整数额度。取消、默认 15 分钟单轮超时、3 分钟无模型进展超时及显式总预算保持有效。所有工具共用的步数拒绝会写入 `budget.failure`，不能仅靠模型正文解释超限。

恢复验证：真实宿主 HTTP 与官方 Pi SDK 配本地替身上游，在轮次执行中读取历史，确认过程说明、已完成工具结果和工程隔离，默认预算为 0，结束后保存完整过程；生产 Sidebar 浏览器验证刷新恢复、运行中的调用仍标为运行中、后续快照更新不重复、切换工程再返回、结算折叠和历史重开。会话日志中断重建覆盖思考过滤与未完成调用状态。宿主预算／事件／历史 44 项、真实宿主专项 1 项、前端流式与状态 33 项通过；类型检查和桌面构建通过。没有真实模型或付费调用。

- 执行中输入默认进入本地会话消息队列，由既有 `/assistant/chat` 在当前轮结算后逐条发送。队列不是第二套模型循环；「引导」仍使用官方 `sendUserMessage(..., { deliverAs: 'steer' })`，消息 ID 作为稳定的指令 ID。只在确认 `received` 后移除待引导记录；回合结束未接收的指令退回待发送队列。删除／编辑只操作尚未送出的本地消息，不假装撤销已送给 SDK 的指令。
- 队列保存在带用户 scope、工程和会话身份的 localforage 中；发送前持久化 `sending`，只有 `turn_start` 或历史中的明确身份回执才能确认接纳。重开及未知结果不会自动重放，整轮失败／停止会暂停队列。用户消息优先于后台素材的自动续接；新的模型轮次仍读取最新工程上下文和现有素材归属校验。

队列验证：生产 Sidebar、消息准备流程、会话 hook 与 NDJSON 解析器配本地替身服务，确认默认发送不进入当前 steer 队列、删除与原地编辑、显式引导、FIFO 自动发送、停止／整轮失败后保留消息、刷新恢复、工程隔离、编辑期间阻止自动发送，以及未接收引导退回队列；没有重复模型轮次。原有生成审批、自动生成、结果续接、停止与新会话隔离浏览器专项通过。流式与工具状态 32 项通过；官方指令队列的身份去重与未处理状态使用现有宿主专项验证。类型检查及桌面预览构建通过，未调用真实付费模型。

- 运行时按官方消息边界保存 `execution`（可见正文与工具调用身份），`finalMessageId` 标记最后一条回复。实时 `text_delta` 带 `messageId`，`assistant_message` 在消息结束时校准正文。模型思考、工具参数和结果不进入此展示记录。
- 系统提示要求制作开始、关键发现、阶段变化及实际阻碍时输出简短的用户进度说明；继续沿用官方正文事件，不新增推理展示或伪造阶段摘要。执行中按实际消息顺序穿插说明和紧凑工具行，一段连续调用默认折叠成「读取了文件与工程」「运行了命令」等摘要，点击后查看每次调用的目标／参数、文本返回或错误；详情与调用状态一起写入原有轮次记录，旧记录没有详情时如实提示。输入中的凭据字段、认证头、签名网址、已识别的凭据文件及媒体数据不进入展示副本。工具事件与正文会清理过时的生命周期提示；有真实运行中的工具时不重复显示泛化的处理中状态。说明频率依赖模型遵循指令，零模型界面验证不能证明真实模型的沟通表现。

进度界面验证：生产 Sidebar、会话 hook 和事件观察器配本地替身，确认说明／工具／说明／工具的顺序、同类读取合并、执行中没有重复等待提示、调用失败详情可展开、最终摘要与真实用时保存及刷新恢复；明暗主题、320px 宽度、键盘展开、减少动效和长历史虚拟列表通过。现有流式与工具状态 32 项通过，类型检查与桌面预览构建通过。没有真实模型或付费调用；HyperFrames 执行端检查报错不属于本次界面验证。
- 完成后只显示最终回复，点击上方「用时」展开按开始顺序组织的过程；同类连续操作合并展示。`metrics` 与过程一同保存到原有轮次日志，重开历史仍可查看。旧轮次没有时间数据时显示「查看过程」，不估算用时。单次工具失败只在过程内显示真实状态，不统计为额外警告或要求用户核对；整轮失败、停止、生成审批、实际后台任务和继续执行入口保留在折叠区外。

- `createTurnObserver` 同时聚合工具状态，结算时将 `toolActivity` 写入原有 `beeftv.turn` 自定义记录及 `turn_end`；历史仍由官方 SessionManager 提供，Go 同源代理按行转发。未收到工具结束事件的调用记为 `interrupted`，不能当作成功。并行调用按调用 ID 独立更新，结束状态不因迟到事件退回执行中。
- 工具完成只表示本次接口调用返回；ASR、生成和导出的后台任务仍由原有任务界面显示真实结果。模型思考增量保持不转发，正文继续过滤思考标签。

工具详情验证：官方事件观察器、生产 NDJSON 解析器和 Sidebar 使用本地替身，确认运行时默认折叠摘要、读取路径与文本内容可见、脚本参数与 stdout 可见、错误保存在展开区、结束后收进用时、历史刷新保留详情；明暗主题、窄栏和键盘交互通过。宿主事件 7 项与前端流式／工具状态 33 项通过，包含凭据字段／认证头／签名网址过滤、敏感文件隐藏、媒体省略和限长。类型检查与桌面构建通过；没有调用真实模型或执行宣传片制作。
- 画布与剪辑共用的 Sidebar 使用 `AIMessageMarkdown`（Streamdown）、专用代码块、WorkingDots 和 GenerationToolCard。流式正文以现有 50 ms 合并刷新，并用 deferred rendering 避免 Markdown 解析挤占输入交互；代码高亮在流式结束后进行。
- 历史区使用稳定回调和反馈对象；30 回合起使用现有 TanStack Virtual 动态高度列表，overscan 为 4。当前流式回合独立渲染。用户向上浏览后停止自动跟随，提供“回到最新消息”，展开内容和高度变化只在跟随状态下滚到底部。
- 零模型页面验收入口：`web/test/fixtures/assistant-streaming-server.ts`。它用生产 Sidebar、hook 和 NDJSON 解析器，模拟短对话、200 回合历史、工具开始/更新/失败及 Markdown 分片，按钮手动推进。使用 Bun 启动；不会调用真实模型，也不会写入产品工程。

摘要界面验证：宿主消息与历史专项 6 项、前端流与工具状态 32 项、展示逻辑独立运行 26 项通过。真实生产 Sidebar 配模拟 NDJSON 验证了实时过程、重复操作合并、最终回复、单次工具失败留在过程内且不额外提示核对、刷新后用时与过程、明暗主题、320px 侧栏、键盘展开、减少动效及 200 回合虚拟列表。过程正文仅在展开时挂载，避免解析不可见的历史 Markdown。类型检查、前端构建和 Windows 桌面预览打包通过；构建保留现有大 chunk 提示。宿主使用本地替身模型，未调用付费模型；桌面已打包，真实创作效果由用户验收。

2026-10-08 验证记录：前端专项 66 项、宿主事件与官方日志专项 5 项通过；`tsc --noEmit` 和 `build:desktop` 通过（构建仍有大 chunk 提示）。浏览器使用上述零模型页面验证工具开始、更新、成功与失败、表格/代码块、历史折叠、停止及明暗主题。200 回合在本次视口挂载 7–11 个历史行，向上浏览时工具事件到达前后 `scrollTop` 均为 13276.032，未被强制拉到底部。截图保存在本机忽略目录 `.local/cache/assistant-streaming/`。这些证据不代表付费模型、整机帧率或安装包验收；桌面安装包未重新打包。

另外运行的 `interrupted-host.test.mjs` 有两项失败：第一项仍预期历史没有 `workflows: []`，与现有历史投影不一致；第二项模拟 `/chat` 请求缺少当前必填的 `skillSnapshot`，无法进入工具执行而超时。上述断言与请求在本次改动前即如此，未修改这些旧 fixture，也没有恢复过时接口。

| 模块 | 责任 |
| --- | --- |
| `session-owner.mjs` | 官方会话创建、按画布预约队列、替换、abort+dispose、原子指针、prompt 结算。 |
| `operation-bridge.mjs` | 已鉴权 `/api/ops`、scope 注入、`customTools`。 |
| `server.mjs` | 本机 HTTP、鉴权、预算 fetch 包装、NDJSON、SIGTERM/SIGINT 释放会话。 |

## 会话所有权

- 预约按 `canvasId`：`ensureSession` / `replaceSession` / `acquireChatSession` 共享一条队列；不同画布并行。
- `acquireChatSession` 在同一把锁里 restore/create 并置 `busy`，然后才释放锁去跑 prompt。忙碌会话的 replace 在工厂之前拒绝（409 `session_busy`）。
- 候选先 `createAgentSession`，指针 `current.*.tmp` + `rename` 成功后才写入 Map；指针失败则 dispose 候选、保留旧活动会话。
- `ensureSession` 只把缺失指针（`ENOENT`）和 `session_not_found` 当成可回退：先 list 可恢复历史，再新建。EISDIR、损坏 JSON、SDK 装配失败原样抛出。
- `disposeOwnedSession` 用 `disposed` 标记，abort+dispose 只走一次。进程 `SIGTERM`/`SIGINT` 先把 store 标为关闭，排空该画布预约队列里已入队的 ensure/replace/chat 占位，再 `disposeAll`。关闭后新的预约直接失败。`SIGKILL` 仍无法拦截，中断回执语义不变。

## 仍由本产品持有

- 画布 scope、operationId、用户确认后的生成、单轮/总预算、中断回执、按画布身份。
- React 只消费 `/api/assistant/*` 流，不在浏览器建 Agent 或 SessionManager。

## 已验证（钉选 0.87.1）

- `session-owner.test.mjs`：真实 `createAgentSession` 创建 / 替换 / `abort`+`dispose`，以及 SessionManager JSONL 往返（不打模型）。并发 replace、指针 EISDIR 回滚、chat 占 busy、ensure 失败不吞。
- `session-settings.test.mjs`：真实 `SettingsManager.inMemory` 读出压缩/重试钉值与 `cacheWarming: "off"`。
- `session-lifecycle-host.test.mjs`：真实宿主 HTTP 新建/并发替换、忙碌 409、指针目录失败、SIGTERM 释放（本地替身模型）。
- `interrupted-host.test.mjs`：SIGKILL 后重启仍能读到 `turn_interrupted` 原话。
- `host-runtime-probe.test.mjs`：预算耗尽、素材参数、引用画布读取。
- React：`lifecycle` 与 `agent_end` 都不结算回合；压缩/重试文案不出现内部事件名。

## 限制

- 未接官方 web-ui / TUI / 实验服务器。
- 未升级 SDK。
- 压缩与自动重试依赖官方内部路径；测试覆盖事件映射与设置钉值，不打付费模型。
- 官方 `SessionManager` 在出现 assistant 消息前不落 jsonl。刚创建就被替换或释放的会话可能不会出现在 list 里；活动会话仍以内存 Map 与 `current.json` 为准。
- Go 运行时、操作层、数据库、生成链路不在本切片。
