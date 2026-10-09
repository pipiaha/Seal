# Seal Agent 与 Codex 能力核对

核对日期：2026-10-09。源码基线：`1d20c2edc701a85688a3b887e273530f9359465a`。

本报告保留上述基线的调研结论，不是当前能力的实时清单。后续已接入工程文件、隔离脚本和联网工具，具体实现与边界见 [Agent 工作目录、脚本与联网](../agent-workspace.md)。

本报告核对产品实际调用路径，而不是只看依赖库或 Skill 包里有没有某个文件。本轮只读源码和官方资料，没有运行测试、模型请求或付费生成，也没有验证所有模型的完整成片成功率。Codex 不同客户端、模型供应商和账户的工具可用性可能不同；下面的比较不表示所有 Codex 会话都拥有同一组工具。

## 主要结论

Seal 已经有真实 Agent 内核：复用固定版本的官方 Pi SDK，提供持久会话、工具调用、压缩、重试、流式显示、运行中补充指令和业务回执。主要差距在执行工具与完整工作流：通用联网检索、受控工作区文件/脚本、MCP 客户端、模型能力配置及诊断还没补齐。无需为了这些差距替换内核。

**当前没有通用联网搜索。** 已有 `skill_search`，但只调用 GitHub 仓库搜索寻找 Skill；不能靠它检索最新资讯、打开任意网页、阅读视频参考页或返回网页来源。安装联网 Skill 也不会自动增加网络执行权限。

**“完全允许”不是 Codex 的完整访问模式。** 当前它只控制 `media_generation_propose` 对应的图片、视频、配音任务自动受理及结果续接。画布节点的 `canvas_generation_propose` 仍走人工点击路径，尚未接同一策略；它也不授予 Shell、任意文件、浏览器或 MCP 权限。

## 逐项源码审计

| 能力 | Seal 状态 | 实现、限制及证据 |
| --- | --- | --- |
| 官方 Agent 循环 | 已有 | 锁定 `@earendil-works/pi-coding-agent` 0.87.1；通过官方 `createAgentSession` 和 `SessionManager` 装配，没有另写模型会话循环。[依赖](../../agent-host/package.json#L7)、[装配](../../agent-host/session-owner.mjs#L182)。 |
| 持久会话与切换 | 已有 | 每工程保存官方会话文件和原子当前会话指针；可列举、恢复、新建、切换。每工程有互斥队列，不同工程不共用锁。[持久化](../../agent-host/session-owner.mjs#L111)、[恢复](../../agent-host/session-owner.mjs#L148)、[锁](../../agent-host/session-owner.mjs#L57)。 |
| 自动压缩与重试 | 已有 | 官方压缩开启，保留最近 20000 Token、预留 16384；Agent 重试最多 3 次，Provider 内层重试设为 0，避免层叠。参数固定，不随模型上下文自动变化。[设置](../../agent-host/session-settings.mjs#L5)。 |
| 模型请求/工具步数预算 | 已有 | 默认每轮 180 秒、40 次模型请求、40 工具步数；可通过运行环境覆盖。还有跨宿主重启保存的总请求计数。这是调用次数预算，不是按 Token/金额计费预算。[默认值](../../agent-host/server.mjs#L45)、[模型计数](../../agent-host/server.mjs#L106)、[持久预算](../../agent-host/durable-request-budget.mjs#L8)。 |
| 流式文本与工具状态 | 已有 | Pi 的正文、工具开始/更新/结束、压缩、重试转换成 NDJSON；右侧助手复用 Streamdown。进度只传工具身份和状态，不展示原始参数、结果或凭据；不是完整执行日志界面。[事件](../../agent-host/lifecycle-events.mjs#L5)、[流式 Markdown](../../web/src/components/ai/ai-message-markdown.tsx#L39)、[助手接入](../../web/src/pages/canvas/canvas-assistant-turn.tsx#L29)。 |
| 思考/推理能力 | 未按模型接通 | 当前会话 `thinkingLevel:'off'`，模型登记 `reasoning:false`；没有完整思考事件到 UI 的链路。这不证明模型内部没有推理，只表示产品没有配置/展示该能力。[会话](../../agent-host/session-owner.mjs#L187)、[模型](../../agent-host/canvas-turn.mjs#L111)。 |
| 工程上下文 | 已有 | 后端从归属已验证文档提取摘要；发送时冻结工程、选区、引用及最近修改；正文按需读取。长工具结果落到当前会话目录，给摘要并通过 `tool_result_read` 分页或搜索。[摘要](../../backend/internal/handler/assistant_context.go#L7)、[上下文](../../agent-host/turn-context.mjs#L23)、[分页](../../agent-host/turn-context.mjs#L48)。 |
| 执行中补充指令 | 已有 | 有持久 instructionId 与状态，通过官方 `sendUserMessage(...deliverAs:'steer')` 追加；前端已接 `/assistant/steer`。它在官方队列边界处理，不会逆转已发出的付费调用。[队列](../../agent-host/turn-instructions.mjs#L10)、[后端](../../backend/internal/handler/agent_proxy.go#L559)、[前端](../../web/src/pages/canvas/use-canvas-assistant.ts#L490)。 |
| 断流/重启恢复 | 已有基础 | 官方会话、计划、工具检查点和业务回执持久化；前端通过历史回读识别仍在运行/已经完成的轮次，避免把断流等同失败。恢复依赖查询实际任务；计划里的 waiting 不是工作进程存活证明。[历史恢复](../../web/src/pages/canvas/use-canvas-assistant.ts#L244)、[检查点](../../agent-host/turn-context.mjs#L92)、[计划](../../agent-host/workflow-journal.mjs#L10)。 |
| 计划与步骤记录 | 已有 | `workflow_read/checkpoint` 保存最多 32 步的目标、状态及任务/候选/操作引用，有版本冲突与幂等保护。没有独立 Plan 模式、结构化多选澄清工具或任意用户输入等待工具；Agent 可以用普通回复询问。[工具](../../agent-host/creator-bridge.mjs#L8)、[记录规则](../../agent-host/workflow-journal.mjs#L15)。 |
| 请求批准/完全允许 | 部分 | 对话默认 ask；用户通过可信 UI 切 allow，后端校验自动受理，宿主禁止自授权；自动生成复用已有渠道。当前不是所有写入统一审批，更不是 OS 沙箱策略。[策略](../../backend/internal/app/assistant_permissions.go#L21)、[受理](../../backend/internal/app/assistant_media.go#L79)、[宿主限制](../../backend/internal/handler/assistant_permissions.go#L9)。 |
| 画布生成与两种模式统一 | 缺少 | 画布提议仍由卡片按钮调用 `onRunProposal`，再走 `executeAssistantProposal`；这条路径没有读取模式、自动接受或生成完成续接。自动协调器只监听持久 `media/proposals`。[分流](../../web/src/pages/canvas/canvas-assistant-sidebar.tsx#L71)、[画布执行](../../web/src/pages/canvas/use-canvas-assistant-proposal.ts#L48)、[按钮](../../web/src/pages/canvas/canvas-assistant-turn.tsx#L116)、[自动处理](../../web/src/pages/canvas/creator-media-tasks.tsx#L91)。 |
| 生成完成自动继续 | 已有但依赖 UI | 当前对话协调器轮询，就绪产物与失败/拒绝结果续接原会话；后端从真实任务授予结果资产并持久登记一次受理。软件关闭期间不会自动运行新的 Agent 回合；原会话重新打开可受理未续接结果。[协调器](../../web/src/pages/canvas/creator-media-tasks.tsx#L105)、[产物校验](../../backend/internal/app/assistant_permissions.go#L104)、[一次受理](../../backend/internal/handler/agent_proxy.go#L477)。 |
| 停止与取消 | 已有范围限制 | 停止 Pi 当前回合、暂停并持久关闭自动续接，尝试取消该会话待续接的 queued/running 生成任务。已经提交上游的工作是否可取消由现有任务/供应商决定，不能承诺撤回消费。[停止](../../web/src/pages/canvas/creator-media-tasks.tsx#L163)、[宿主 abort](../../agent-host/server.mjs#L324)。 |
| 图片视觉输入 | 已有 | 真实 JPEG/PNG 数据进入官方 prompt；图片数量/大小按模型配置限制；旧图可以按附件 ID 重读。过去图像超额时仅在请求投影中省略，保留原会话记录。[输入](../../agent-host/visual-input.mjs#L1)、[prompt](../../agent-host/server.mjs#L385)、[重读](../../agent-host/turn-context.mjs#L72)。 |
| 视频/音频输入 | 已有抽帧与 ASR | 可附音视频引用及文字/字幕文件；Agent 通过媒体工具读实际时长、采样帧、ASR 时间戳。没有把原视频/音频直接作为模型原生输入：模型登记 input 只有 text/image；抽样不能等同看过完整视频，ASR 不理解音乐/音效。[附件校验](../../backend/internal/handler/assistant_media_input.go#L21)、[媒体工具](../../agent-host/creator-bridge.mjs#L7)、[工程工具](../../agent-host/edit-bridge.mjs#L17)、[模型输入](../../agent-host/canvas-turn.mjs#L114)。 |
| Skill 发现/显式调用/热加载 | 已有 | 后端每轮生成当前用户启用技能快照；Pi 通过官方技能加载 API 读取。快照版本变化时重载技能资源，当前轮不被中途替换；产品已有选中技能传入链路。[可信快照](../../backend/internal/handler/agent_proxy.go#L443)、[下轮更新](../../agent-host/session-owner.mjs#L288)、[读取](../../agent-host/full-control-loader.mjs#L49)。 |
| Skill 作者与下载 | 已有 | 可验证并保存用户 Skill、按哈希更新；GitHub 下载固定实际提交。格式验证与行为验证分开，保存不代表效果已验证。[创作工具](../../agent-host/creator-bridge.mjs#L15)、[格式结果](../../backend/internal/skills/hub_author.go#L75)、[下载](../../backend/internal/skills/hub_author.go#L123)。 |
| Skill 附带脚本执行 | 未提供通用执行 | 入口明确脚本保持 inert；仅提供 HyperFrames/Hypit 的固定受控执行工具。下载包里有 Python/JS/Shell 不等于可运行；allow 也不授予它们权限。[工具合同](../../agent-host/creator-bridge.mjs#L16)、[系统边界](../../agent-host/full-control-loader.mjs#L22)、[固定 CLI](../../agent-host/hyperframes-bridge.mjs#L17)。 |
| 通用文件/命令/Shell | 未提供 | Pi 内置工具显式关闭；`read` 只允许已发现 Skill 的文件，`edit_read` 只读当前工程，Hypit 文件写入也有独立合同。没有 Codex 式工作区 ls/rg/write/apply_patch/exec 通用工具。[关闭内置工具](../../agent-host/session-owner.mjs#L188)、[Skill read](../../agent-host/skill-read-bridge.mjs#L57)、[工程 read](../../agent-host/edit-bridge.mjs#L21)。 |
| 联网搜索/网页阅读 | 缺少通用链路 | `skill_search` 是公开 GitHub 仓库搜索，后端实际请求 `api.github.com/search/repositories?...query+skill`。工具装配没有 web_search、open_url 或浏览器工具，不能把底层 Node fetch 当作模型可调用网络工具。[装配全集](../../agent-host/server.mjs#L157)、[Skill 搜索](../../agent-host/creator-bridge.mjs#L19)、[实际上游](../../backend/internal/skills/hub_author.go#L112)。 |
| MCP | 只有服务端 | Seal CLI 用官方 Go MCP SDK 注册工作区操作并开放 STDIO，方便外部 Codex/Claude 操作 Seal。当前内置助手没有连接外部 MCP 服务器的客户端管理、认证、工具装配或资源读取。[服务端](../../backend/cmd/beeftv/main.go#L646)、[外部配置](../../backend/internal/handler/agent_clients.go#L181)、[内置装配](../../agent-host/server.mjs#L157)。 |
| 动态工具发现 | 部分 | 工作区操作描述通过 `/ops` 加载，再转换成 Pi 自定义工具；其余编辑/Hypit/HyperFrames/创作工具固定注册。没有基于工具目录的按需 tool_search/渐进发现，也不会因为装了某个 Skill 就增加新执行工具。[ops 描述](../../agent-host/operation-bridge.mjs#L56)、[固定装配](../../agent-host/server.mjs#L157)。 |
| 工具并发与多 Agent | 部分/缺少 | 业务写工具注明 sequential；只读 ops 没强制串行，工程会话锁相互独立。画布生成执行器有并发，但这些不等于子 Agent 调度。没有 spawn/send/wait 子 Agent 工具及各自上下文管理。[写工具](../../agent-host/operation-bridge.mjs#L70)、[串行创作工具](../../agent-host/creator-bridge.mjs#L28)、[会话锁](../../agent-host/session-owner.mjs#L57)、[生成并发](../../web/src/pages/canvas/canvas-assistant-proposal-execution.ts#L82)。 |
| 后台长任务/调度 | 部分 | 生图/视频、ASR、Hypit、导出有实际异步任务/查询工具；会话有等待与继续入口。但没有脱离当前 UI 的通用 Agent 作业调度、定时唤醒、后台 Shell 会话或系统通知编排。[任务工具](../../agent-host/creator-bridge.mjs#L12)、[ASR](../../agent-host/creator-bridge.mjs#L22)、[导出](../../agent-host/hyperframes-bridge.mjs#L21)、[超时](../../agent-host/server.mjs#L47)。 |
| 模型能力契约 | 部分且优先补齐 | 模型配置实际映射协议及图片数量/字节；默认 contextWindow=200000、maxTokens=4096，可用环境覆盖，但没从每个模型配置映射。登记 reasoning=false、成本=0；未根据模型配置区分 tools/reasoning/请求参数限制。这会让压缩、输出额度和参数兼容性与真实模型不一致。[默认](../../agent-host/server.mjs#L45)、[登记](../../agent-host/canvas-turn.mjs#L111)、[配置结构](../../backend/internal/modelcatalog/assistant.go#L28)、[视觉映射](../../backend/internal/modelcatalog/assistant.go#L155)、[启动环境](../../backend/internal/assistantruntime/env.go#L24)。 |
| 用量/诊断 | 部分 | 宿主已有首次正文耗时、总耗时、模型请求次数、工具次数，以及工具日志和实际模型请求路径记录。但 turn_end 未投影输入/输出/缓存 Token 与实际费用，cost=0 只是 SDK 估算配置，绝不能理解为真实免费。[请求账本](../../agent-host/server.mjs#L123)、[轮次 metrics](../../agent-host/server.mjs#L411)、[工具耗时](../../agent-host/operation-bridge.mjs#L111)、[cost](../../agent-host/canvas-turn.mjs#L117)。 |
| 素材库自主检索 | 缺少助手入口 | 产品公共操作层有 asset.list/canvas.search，但内置助手可信范围明确隐藏两者，仅允许关联/显式引用资产读取。并未接可授权集合内的分页检索，更没有镜头标签、OCR 或内容语义索引。[助手白名单](../../backend/internal/agentops/scope.go#L22)、[现有列表](../../backend/internal/operations/ops.go#L24)。 |
| 剪辑、候选、检查、导出 | 已有领域工具 | 能切割/删除/修改元素和时间、查看实际工程画面、制作 HTML/GSAP 候选、检查、入轨、撤销及导出真实任务。它们是 Seal 的产品能力，不必照抄 Codex 文件编辑方式。[剪辑](../../agent-host/edit-bridge.mjs#L17)、[候选和导出](../../agent-host/hyperframes-bridge.mjs#L8)。 |
| 自动成片复查与交付 | 部分 | 当前能看工程及候选截图；导出状态能读，但没有按 exportId 读取最终视频的 Agent 检查入口和幂等保存成片资产工具。保存成片仍是 UI 调用；检查截图也需要适配模型数量上限，不能固定 5 张超出当前限额。[导出](../../agent-host/hyperframes-bridge.mjs#L21)、[固定截图](../../agent-host/hyperframes-bridge.mjs#L18)、[图片拒绝](../../agent-host/turn-context.mjs#L98)、[UI 交付](../../web/src/pages/edit/edit-assets.tsx#L129)、[保存实现](../../web/src/services/edit-export-assets.ts#L17)。 |

## Codex 官方对照及适用性

| 能力 | 官方 Codex 能力 | 对 Seal 的判断 |
| --- | --- | --- |
| 会话运行接口 | App Server 提供 thread/resume、thread/compact/start、turn/steer；模型列表有推理额度及 inputModalities，用量有 thread/tokenUsage/updated。结构化 tool/requestUserInput 为实验接口。[App Server](https://learn.chatgpt.com/docs/app-server)。 | Seal 的会话恢复、压缩与 steering 已有对应概念，差距在模型能力/用量投影和结构化澄清 UI，不能因此判定其整个内核缺失。 |
| 搜网 | 有独立托管 web_search；本地默认缓存检索，可配置 live/disabled，与 Shell 的网络访问分开；自定义模型供应商是否可用需单独核对。[官方说明](https://learn.chatgpt.com/docs/web-search)。 | Seal 需要显式添加搜索与网页读取工具及来源展示；不能假定 Pi 或 OpenAI-compatible 接口自动附送 Codex 搜网。 |
| 文件与命令 | CLI 能读本地仓库、改文件、运行已有工具。[CLI](https://learn.chatgpt.com/docs/codex/cli)。 | Seal 如果希望广泛使用技能脚本，需增加受控工作目录文件/执行能力；它可以是进阶能力，不要求新手承受终端操作。 |
| 权限 | 官方将 OS 沙箱和审批策略区分为两层；决定实际可访问范围与何时请求批准。[权限](https://learn.chatgpt.com/docs/agent-approvals-security)。 | Seal 当前是业务 API 权限与生成许可，没有同等的任意命令沙箱。接命令执行前要单独设计范围、进程取消与凭据隔离。 |
| MCP | Codex 是 MCP 客户端，支持 STDIO、Streamable HTTP、Bearer/OAuth 等；配置真实服务器并读取它们的工具/上下文。[MCP](https://learn.chatgpt.com/docs/extend/mcp)。 | Seal 的 MCP 服务端只是向外开放，方向相反。添加内置 MCP 客户端后才有外部能力扩展。 |
| Skills/Plugins | Skill 是说明和支持资源，Plugin 可组合 Skill、MCP、钩子等。用户可显式调用，也可按需求选择；运行能力来自工具与执行环境。[技能与插件](https://learn.chatgpt.com/docs/skills-and-plugins)。 | Seal 的本地 Skill 管理已较完整，但执行环境有限；先补必要工具，再迁移与它匹配的技能。 |
| 子 Agent | 官方支持分工/并行并收集结果，有独立 Agent 配置和额外 Token 消耗；调用策略随客户端及指令而变。[子 Agent](https://learn.chatgpt.com/docs/agent-configuration/subagents)。 | 用户此前选择单 Agent；当前先补单 Agent 工具闭环，子 Agent 不是必须架构，不应仅为对标增加复杂度。 |

官方资料证明这些 Codex 功能存在，并不证明其内部实现细节与 Pi 一样。没有官方依据的 Token 展示、调度算法、自动选模或端到端影片质量不作同等断言。

## 建议的补齐顺序

1. **先统一现有权限合同与提示词。** 将画布节点生成接到同一对话策略/任务回执/续接合同；修正系统提示中仍一律要求人工确认的文案。需要对用户清楚表达 allow 是哪些行为的允许。[残留提示](../../agent-host/full-control-loader.mjs#L18)、[重复确认指令](../../agent-host/full-control-loader.mjs#L37)。
2. **接联网搜索与网页读取。** 搜索返回 title/url/date/snippet，网页读取返回正文、来源和大小限制；默认查资料与联网下载/第三方执行分开。业务实现可以选独立搜索供应商或 MCP，但不把普通 Skill 当搜索引擎。
3. **补模型能力与用量契约。** 每模型配置 contextWindow、maxOutputTokens、tool/vision/reasoning 支持与必要参数；同步 Pi 登记和压缩额度；投影真实 Token/缓存/耗时/实际渠道。避免靠错误默认值导致表面能力齐全、换模型后失效。
4. **补素材检索与生成参考传递。** 在后端授权的当前工程/素材集合内提供分页搜索；把实际参考图/视频/音频 ID 接到生成提议和渠道能力校验。Agent 看到了参考图，不等于生成模型收到了参考图。[现有提议参数](../../agent-host/creator-bridge.mjs#L10)、[生成准备](../../web/src/pages/canvas/creator-media-tasks.tsx#L69)。
5. **补成片复查及交付工具。** 按 exportId 查询实际视频/音轨信息、抽帧并检查，使用真实导出版本幂等归档；不要把候选截图成功等同成片已通过复查。
6. **需要广泛技能执行时再加受控工作区或 MCP 客户端。** 当前领域工具足够执行部分视频流程，但通用技能的文件、脚本、浏览器能力不能凭提示词补齐。先选明确使用场景，避免同时建任意 Shell、浏览器、多 Agent 与调度系统。

这些是源码状态与实施建议。本报告不是授权执行功能开发；优先级可以由产品目标调整。暂时不需要照搬 Codex 专属的 Worktree、代码 Review、云执行或自动化 UI。
