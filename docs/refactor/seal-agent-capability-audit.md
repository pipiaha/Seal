# Seal Agent 能力深入审查

审查日期：2026-10-09。源码基线：`1ec0ebb0a7ddd2e97189801e081f4d460c81de04`。已先读取 AGENTS.md。本次只审查、验证和记录，没有修改实现、提交、推送、使用真实模型密钥或进行付费生成。

## 结论

Seal 已经有能工作的制作部件：官方 Pi 会话、真实图片输入、素材抽帧、本地 ASR、原生剪辑操作、Hypit 制作、HyperFrames 候选检查与截图、真实音视频导出、历史和版本保护。它并非只有工具列表。

但还不能认定它能稳定独立完成“找素材 → 补素材 → 制作 → 复查 → 导出归档 → 中断后继续”的闭环。主要断点在产品接线，而不是缺少另一个 Agent 或需要换 Runtime：发现的资产不能直接导入剪辑；生成提议不能携带参考素材和逐次生成参数；自动续接依赖打开的助手 UI；ASR、Hypit 和导出没有同等续接；最终 MP4 缺少 Agent 可用的复查、归档入口。

另有一个应先于功能扩充处理的执行边界漏洞：**通用 `workspace_run` 的 AppContainer 不覆盖 Hypit 作者 JS。正式 Hypit `check` 可以执行作者组件，读写作者工程外的文件。** 本次只用合成哨兵和合成回执验证，没有接触真实密钥或用户工程。

“完整任务成功率”仍未验证：本次没有让真实模型完成六条端到端创作任务。真实运行证明某些执行链能工作；替身验证证明接口和状态逻辑；两者都不能证明模型能稳定选择正确工具、制作高质量视频。

## 证据与状态定义

- **真实运行**：正式运行端、OS 隔离、CLI、浏览器、FFmpeg、Whisper 或持久化读写执行；素材为公开测试样本或合成材料。
- **替身验证**：真实产品代码搭配替身模型、HTTP 上游、图片或返回值；不证明真实供应商或模型表现。
- **源码推断**：直接追踪调用方、参数、权限判断和返回路径；没有对应实跑。
- **未验证**：没有足够证据，尤其是实际供应商请求、真实模型规划、复杂内容质量和发行环境。
- **已完成**：限定在表中明确描述的能力；不等于产品全流程可靠。
- **部分完成**：有真实能力，但存在接线、覆盖范围或恢复限制。
- **缺失**：当前调用链没有对应入口或机制；模型能通过别的工具绕路，不等于原生链路完整。

P1 表示应优先修复的执行边界或主流程阻断；P2 表示条件性阻断、恢复或体验缺口。未把“未验证”自动归类成缺陷。

## Agent 能力表

| 能力 | 状态 | 实际成立的范围与限制 | 证据 |
| --- | --- | --- | --- |
| 官方 Pi SDK 会话与工具循环 | 已完成 | 钉选 0.87.1；不另建自制模型循环 | SDK 锁定、会话源码与专项测试 |
| 会话保存、重开、轮次回执 | 已完成 | 官方 journal 与后端轮次记录；断流可找真实受理回执，不能保证所有异步工作自动继续 | 上下文/历史恢复专项测试 |
| 渠道连接映射 | 部分完成 | OpenAI completions/responses、Anthropic；方舟/智谱端点拼接错误，原生 Gemini 与自定义 Headers 未接助手 | F04 |
| 按模型的上下文/输出/推理/工具能力 | 部分完成 | 视觉额度进入 Runtime；其余主要是固定值，没有工具能力探测 | F05 |
| 上传/粘贴/引用图片实际进模型 | 已完成 | 图片内容进入 SDK prompt，图片额度有验证；历史图片有读取工具 | 视觉与附件测试；不含真实供应商视觉验收 |
| 视频/音频输入 | 部分完成 | 视频经带时间的抽帧、声音经 ASR；不是原生整段视频/音频模型输入，也不理解全部音乐/音效 | 媒体工具链、ASR 实跑 |
| 当前工程、选区、版本与最近结果上下文 | 已完成 | 后端验证工程/版本，轮次冻结区域；写入 CAS；摘要受长度限制 | 上下文、版本与原生检查测试 |
| 长工具结果按需读取 | 已完成 | 超过 12,000 字符落私有文件，6,000 字符分页/搜索；结果是旧快照 | `turn-context` 实测 |
| 压缩后完整保留所有制作约束 | 未验证 | SDK 压缩存在；近期摘要只保留有限条数，部分产物身份不进 checkpoint；没有实际长视频会话压缩验收 | F10、源码 |
| 资产库检索 | 部分完成 | 标题/元数据字符串检索；可读真实画面，未建立镜头/转写内容索引 | F03、F15 |
| 自动找到资产并入剪辑 | 部分完成 | 可找、可检查；原生导入仍要求轮次初始引用 | F03 |
| 生图/生视频/配音与审批 | 部分完成 | 已配置渠道、持久提议、人工批准或 UI 自动提交；缺参考素材和本次参数，画布路径不同 | F06、F07 |
| 生成完成后的自动续接 | 部分完成 | 独立素材提议 READY 后可自动续接同会话，并 CAS 防重复；依赖 UI，失败尝试会锁住本地重试 | F07 |
| 本地 ASR | 已完成 | Whisper Base 实际转写带时间、SRT，任务重开复用；不能等同精确强制对齐或配音 | 实际 JFK 样本测试 |
| ASR → 字幕 → 剪辑 → 导出一体推进 | 部分完成 | 各工具可组合；ASR 完成没有自动唤醒，字幕可做成原生文字候选，整体流程未由真实模型验收 | F07 |
| 时间线读写、拆分、移动、历史与撤销 | 已完成 | 使用原生接口、版本及真实历史；不覆盖剪映所有高级特效 | 原生 HyperFrames 集成实跑 |
| HyperFrames HTML/GSAP 可编辑候选 | 已完成 | 固定 CLI 0.8.130；候选、check、截图、晋升、导出真实工作；截图额度有条件性断点 | F12、原生集成实跑 |
| Hypit 本地检查/计划/构建/候选 | 已完成 | 官方 CLI 的本地工程链真实通过；不能据此认定任意复刻与复杂组件可靠 | Hypit 集成实跑；安全边界见 F01 |
| 通用 Skill JS/Python 执行 | 部分完成 | Windows AppContainer 真实存在；当前 E 盘目录 ACL 阻断，Python 发行 readiness 不完整，120 秒同步上限 | F02、F13 |
| 所有作者代码遵守当前工作区隔离 | 部分完成 | 通用脚本隔离有效；Hypit 原生作者通道绕过，不能宣称全局隔离 | F01 |
| 脚本输出发现、检查、入资产库 | 部分完成 | 目录工具 + 媒体探测 + publish 可用；依赖模型发现产物，无统一产物回执，入原生剪辑仍被引用范围拦截 | F03、F10、F13 |
| Skill 发现、指定、读取、启停、热加载 | 已完成 | 启用快照每轮冻结，下一轮 reload；指定 Skill 载入完整入口，引用页按需读取 | Skill 专项测试 |
| Skill 附带完整 helper 能直接运行 | 部分完成 | 完整包可复制；旧说明禁令与新执行能力矛盾，部分 helper 需要未准备的工具 | F13 |
| 创建、验证、保存 Skill | 部分完成 | 支持格式预览/保存、哈希更新；明确 `behaviorVerified:false`，没有行为验收闭环 | F13 |
| 联网搜索/阅读/下载与来源 | 部分完成 | 有 Tavily、公开文本读取、下载、来源 URL；当前机器 fake-IP DNS 导致真实网页读取失败 | F14 |
| 执行中补充指令 | 已完成 | 官方 steer 队列、去重、收到/未处理回执；不扩大本轮素材权限 | 上下文/steer 测试 |
| 停止全部关联制作任务 | 部分完成 | 模型和通用脚本可停，独立生成有取消；Hypit、ASR、导出没有在助手停止处统一取消 | F08 |
| 强制退出/重启后识别失活任务 | 部分完成 | Hypit 标记 interrupted、生成/ASR 有持久任务；导出残留 rendering/preparing 缺少重对账 | F09 |
| 最终 MP4 复查与归档 | 缺失 | 能导出、看状态；Agent 没有直接检查该导出文件/保存成资产的工具，UI 手动操作有 | F11 |
| 工具状态与流式回复 | 已完成 | start/update/end、历史恢复、错误可见；不含充分进度与耗时 | 前端/生命周期测试 |
| Token、缓存用量、分步耗时/失败诊断 | 部分完成 | 首字/总耗时、调用数量和重试阶段；没有 SDK usage、逐工具时间与具体网络原因链 | F16 |
| 任意目标的自主成片质量/稳定性 | 未验证 | 没有真实模型的全流程成功率、质量与长会话回归证据 | 本次不付费、不调用真实模型 |

## 六条完整任务调用链

### A. 找到已有素材，剪成一个短视频

`composer → assistant/chat → 后端工程验证/BeginTurn → Pi session → assets_search → media_read → hyperframes_import_asset → edit_read/patch/split → hyperframes_export → hyperframes_exports`。

检索读取面向当前用户资产库；**导入却检查本轮起始 `AssetIDs`**。用户没有先 @ 的素材，即使 Agent 刚查询到真实 ID，也被 `asset_out_of_scope` 拒绝。当前工程已导入的素材可以直接剪，手动 @ 的资产可以导入。生成续接把 READY 资产加入下一轮引用，因此那条特定路径可避开该阻断；不能据此认定任意检索导入已接通。

位置：[素材检索与副本导入](E:/douyin/BeefTV/backend/internal/app/assistant_workspace.go:90)、[剪辑导入范围判断](E:/douyin/BeefTV/backend/internal/handler/edit_projects.go:112)、[原生导入说明](E:/douyin/BeefTV/agent-host/hyperframes-bridge.mjs:20)。证据：源码；旧权限测试提前失败，未完成该路由的动态测试，见验证记录。

### B. 生成缺失素材，完成后继续剪辑

`workflow_checkpoint → media_generation_propose → 后端保存提议 → Sidebar 审批/allow 自动 start → prepareBackendGenerationTask → 持久生成任务 → READY 资产 → Sidebar send(continuationProposalId, asset refs) → 后端续接 CAS → 同会话继续`。

这条链的正常 UI 路径通过替身浏览器验证，真实后端的生成/入库/重开防重通过本地上游替身验证。缺口是：参考素材/时长等无法随提议发送；隐藏助手会卸载续接组件；离开页面或关闭应用后没有后台 Agent 调度；续接受理前失败被 `attempted` 集合永久跳过到组件重挂载。画布节点提议另走用户确认回调，不走同一自动续接分支。

位置：[生成参数](E:/douyin/BeefTV/agent-host/creator-bridge.mjs:22)、[提交与续接](E:/douyin/BeefTV/web/src/pages/canvas/creator-media-tasks.tsx:69)、[挂载条件](E:/douyin/BeefTV/web/src/pages/edit/project.tsx:251)、[后端续接 CAS](E:/douyin/BeefTV/backend/internal/repository/assistant_media_proposal.go:52)。

### C. 根据参考视频，结合 Skill 制作可编辑场景

`Skill 快照/指定入口 → read 引用 → media_read 或 hypit_import_asset/reference_frames → 分析参考 → hypit_write/run/check/plan/build → job_status → candidate → 原生晋升 → 时间线/导出`；或直接 `hyperframes_candidate → check/snapshot → add_scene`。

两种执行链各自都真实通过合成场景验证，并非只能渲染 MP4 再导入。复刻需要的参考条件生成受 F06 限制；新找到的参考素材受 F03 限制；Hypit 作者 JS 的宿主执行边界受 F01 影响；HyperFrames 检查实际返回五张图，低图片额度模型受 F12 影响。完整“参考视频 → 高质量复刻”本次未由真实模型验证。

位置：[Hypit 工具链](E:/douyin/BeefTV/agent-host/hypit-bridge.mjs:22)、[官方候选检查](E:/douyin/BeefTV/edit-host/hyperframes-scenes.mjs:210)。

### D. 转写口播、处理字幕并导出

`media_transcribe / edit_transcribe → owned resource + 来源/哈希校验 → timeline_transcription 持久任务 → media_transcription → 时间戳/SRT → 编辑或文字候选 → 原生导出`。

本地 Whisper 真实测试确认：转写、近似 token 时间、SRT、关闭数据库后重新打开、同输入复用一个任务均可用。剪辑素材读取有来源和片段 placement 信息；模型需要结合裁剪/速度把源时间映射到工程时间，不能直接把源文件 SRT 当成剪后字幕。缺少 ASR 完成的自动唤醒，以及整条口播字幕制作的真实模型验收。不是“缺 ASR 引擎”。

位置：[ASR 来源验证与任务创建](E:/douyin/BeefTV/backend/internal/app/assistant_transcription.go:42)、[转写状态读取](E:/douyin/BeefTV/backend/internal/handler/assistant_creator.go:207)、[真实重开测试](E:/douyin/BeefTV/backend/internal/app/assistant_transcription_test.go:68)。

### E. 制作途中修改要求，然后停止并恢复

`steer → 官方用户消息队列 → 观察实际收到 → 指令回执 → cancel/abort → 读取 official journal/后端回执 → workflow_read + 实际任务状态 → 人工继续或生成自动续接`。

补充指令的接收、去重、未处理状态通过替身 SDK 队列测试；断流后的前端受理身份恢复通过纯函数测试。它不改变已冻结选区、Skill 或素材权限，这是有效边界。停止处仅枚举独立生成任务；不会顺便调用 Hypit cancel、ASR task cancel 或 export cancel。手动工程修改由 CAS/历史冲突保护，不会静默覆盖；但模型读最新状态、合并用户新要求的正确率未验证。

位置：[steer 队列](E:/douyin/BeefTV/agent-host/turn-instructions.mjs:1)、[助手停止](E:/douyin/BeefTV/web/src/pages/canvas/creator-media-tasks.tsx:163)、[宿主 abort](E:/douyin/BeefTV/agent-host/server.mjs:324)、[人工继续](E:/douyin/BeefTV/web/src/pages/canvas/canvas-assistant-sidebar.tsx:55)。

### F. 运行 Skill 脚本，检查输出，再加入工程

`read/workspace_skill → workspace_files → workspace_install（按需）→ workspace_run → workspace_runs/files → workspace_publish → assetId → native import`。

通用脚本 Windows 隔离真实有效；当前默认 E 盘执行根 ACL 可能让脚本根本启动不了。所需 Python/FFmpeg/Bash 不一定存在；只安装 JS/Python 依赖不等于外部可执行程序齐全。脚本完成需要模型主动检查产物，并 publish 成媒体资产；入剪辑仍受 F03 拦截。跨轮新的工具身份可能再次执行同一脚本，非零退出也可能在 UI 记为完成。

此外，Agent 工作目录和原生剪辑 work 是两个根。`hyperframes_candidate.assets[].source` 只读原生 work，下载到 Agent work 的字体/SVG 不能直接绑定；媒体可以 publish 后再原生导入，非媒体依赖没有对应受控迁移入口。不是要求合并两个目录，只需按真实需求增加受控绑定。

位置：[工作区工具](E:/douyin/BeefTV/agent-host/creator-bridge.mjs:12)、[媒体发布](E:/douyin/BeefTV/backend/internal/app/assistant_workspace.go:143)、[候选文件来源](E:/douyin/BeefTV/edit-host/hyperframes-scenes.mjs:153)。

## 缺陷、断点及最小修复

### F01 · P1 · Hypit 作者代码绕过当前工作区隔离

**真实运行复现。** `hypit_write` 允许 JS/TS/MJS 和作者 package；生产运行端把作者包复制到冻结工程的 node_modules，普通 fork/spawn 启动官方 CLI。上游 activation 通过 Node import 执行，模块作用域不是安全沙箱，Node 内置模块未禁止。

只调用正式 `productions.write` 和 `productions.start(command:'check')`，合成作者组件就能读取其冻结工作区外的合成哨兵，并改写另一合成工程的回执，check 仍正常 complete。没有读真实密钥/数据库或操作已有工程。清理环境变量、限制资源 URI、锁版本不能限制这一通道的宿主文件访问。

**影响：** 通用脚本隔离成立，但“所有 Agent 作者执行都只在当前工作区”不成立；外部 Skill 或模型编写的组件存在接触宿主文件、其他工程和回执的风险。不能用“受控工具名”代替执行隔离。

**最小修复：** 将作者加载/check/plan/build 的整条进程链纳入等价 OS 沙箱，限定冻结输入/输出、只读 distribution 和所需媒体工具，回执保留在沙箱外；取消拥有整个进程树。短期可先关闭自编 activation/package 执行入口作为止血，保留可信内置组件。提示词禁令、单个 import 黑名单不能作为修复。

位置：[作者源码](E:/douyin/BeefTV/edit-host/hypit-productions.mjs:62)、[复制作者包](E:/douyin/BeefTV/edit-host/hypit-productions.mjs:147)、[普通 fork](E:/douyin/BeefTV/edit-host/hypit-productions.mjs:169)、[普通 CLI spawn](E:/douyin/BeefTV/edit-host/hypit-production-worker.mjs:18)、[activation 导入](E:/douyin/hypit/packages/package-loader-node/src/loader.ts:112)、[模块作用域边界](E:/douyin/hypit/packages/package-loader-node/src/module-scope.ts:133)。

### F02 · P1 · E 盘执行根 ACL 会阻断通用脚本，readiness 却仍显示可用

**真实运行 + 控制实验。** 本次新建的审计缓存工程继承当前 E 盘用户 Modify ACL，正式 Manager.Run 返回 `workspace ACL: Access is denied.`。AppContainer DACL 已添加，但 Low integrity 标签未写入。仅给审计缓存父目录的当前用户 FullControl，再建新合成工程，同一脚本成功；跨工程访问仍被隔离拒绝。产品数据目录、用户工程 ACL 未改。

桌面预览默认数据根也位于该 E 盘路径。Status 只查 Windows 函数和解释器文件，不做实际启动自检，所以“sandbox=true”不足以证明当前目录能运行。系统 TEMP 的既有测试通过，说明不是所有 Windows 目录都失败。

**最小修复：** 服务创建私有执行根时设置所需管理权限，再添加低完整性/AppContainer 授权；仅操作自己的执行根。增加小型 readiness 启动探测和可解释错误，不提权、不放开整盘、不回退无隔离运行。

位置：[完整性标签写入](E:/douyin/BeefTV/backend/internal/agentworkspace/sandbox_windows.go:71)、[启动授权](E:/douyin/BeefTV/backend/internal/agentworkspace/sandbox_windows.go:90)、[readiness](E:/douyin/BeefTV/backend/internal/agentworkspace/workspace.go:641)、[预览默认数据根](E:/douyin/BeefTV/scripts/start-editing-preview.ps1:18)。

### F03 · P1 · 资产检索、脚本产物发布与原生导入的范围不一致

**源码确定。** assets_search/media_read/workspace_asset_import 能使用当前用户真实资产；hyperframes_import_asset/hypit_import_asset 只接受 BeginTurn 时的 AssetIDs。刚发现/下载发布的资产不在冻结列表，导入返回 403，提示“请在当前对话中引用”。执行中追加文字不能扩大这个列表。

**影响：** Agent 仍要用户 @、开新轮或手动搬素材，无法真正自己找素材完成剪辑。生成自动续接会追加结果引用，只覆盖特定生成路径。

**最小修复：** 原生导入按当前用户资产归属、当前工程和打开轮次验证；若继续保留轮次资产授权，则由服务对检索/发布结果登记授权，不让模型任意改白名单。保留资源来源、版本和幂等保护。无需开放其他用户或任意文件。

位置：[asset_out_of_scope 判断](E:/douyin/BeefTV/backend/internal/handler/edit_projects.go:112)、[资产检索/复制/发布](E:/douyin/BeefTV/backend/internal/app/assistant_workspace.go:90)。

### F04 · P1/P2 · 部分可选渠道无法作为助手实际工作

**源码 + 协议投影测试；真实供应商未调用。** OpenAI 兼容端点被无条件补 `/v1`：方舟 `/api/v3` 变 `/api/v3/v1`，智谱 `/api/paas/v4` 变 `/api/paas/v4/v1`，钉选 SDK 直接使用该 baseURL。相邻测试只覆盖裸 origin 和 /v1，没有覆盖产品预设。

原生 Google `gemini-generate-content` 可以在设置保存，但助手支持列表没有它，会明确返回 `model_protocol_unsupported`。自定义 Headers 可配置，AssistantChannel/Provider 未携带给 SDK；需要额外网关鉴权头的渠道不能复用。前者是产品协议覆盖缺口，明确拒绝是正确行为；后者是配置映射缺口。

**最小修复：** 显式路径保留，仅对裸 origin 补协议默认路径；用实际产品预设覆盖本地替身请求。助手模型选择器过滤/解释不支持协议；按需要接 SDK 原生适配和去敏/过滤的自定义 Header，不默认换模型。

位置：[预设](E:/douyin/BeefTV/web/src/lib/model-service-presets.ts:12)、[错误路径补全](E:/douyin/BeefTV/backend/internal/assistantruntime/env.go:155)、[助手支持与 channel 投影](E:/douyin/BeefTV/backend/internal/modelcatalog/assistant.go:19)、[SDK provider 注册](E:/douyin/BeefTV/agent-host/canvas-turn.mjs:111)。官方路径依据：[方舟说明](https://docs.volcengine.com/docs/ark/base-url-and-authentication?lang=en)、[智谱 OpenAI 示例](https://docs.bigmodel.cn/cn/best-practice/case/ai-search-engine)。

### F05 · P1/P2 · 模型能力仍没有真正驱动 Runtime

**源码。** 默认登记 200,000 context、4,096 output，reasoning=false、thinkingLevel=off。部署环境可以改变容量，但渠道模型配置没有逐模型映射这些参数。视觉额度映射成立；没有明确的工具调用能力合同。支持推理的模型可能仍有内部推理，不应把 `off` 说成模型不能思考；缺的是可配置控制。

**影响：** 较小上下文模型可能在应用认为尚未满时就被上游拒绝；复杂场景代码受统一输出限制；模型切换后策略不能按其真实容量变化。当前 compaction 预留/保留也要和小模型预算匹配。

**最小修复：** 一个小的 canonical 模型能力对象驱动 SDK 注册、输出、压缩阈值、图片/工具/推理支持。未知能力明确保守默认或提示；不要先建立庞大供应商数据库。

位置：[当前 provider 字段](E:/douyin/BeefTV/backend/internal/assistant/provider.go:40)、[能力投影](E:/douyin/BeefTV/backend/internal/modelcatalog/assistant.go:32)、[固定容量](E:/douyin/BeefTV/agent-host/server.mjs:45)、[reasoning](E:/douyin/BeefTV/agent-host/canvas-turn.mjs:113)、[thinking](E:/douyin/BeefTV/agent-host/session-owner.mjs:187)、[压缩设置](E:/douyin/BeefTV/agent-host/session-settings.mjs:6)。

### F06 · P1 · 素材生成提议不能携带参考素材与本次制作参数

**源码确定。** 工具只有 kind/prompt/model/workflowId/stepId；持久提议没有 reference asset IDs 或生成控制。UI prepareBackendGenerationTask 只传提示词和当前配置，referenceImages/Videos/Audios 默认空数组。

**影响：** 助手“看到产品图片”与视频生成供应商“拿到产品参考图”是两件事。前者成立，后者在此路径未接通。必须参考图的视频协议可能直接预检失败；其他协议会按文字生成。Agent 不能逐段明确指定时长、画幅、首尾帧或声音等受支持参数，只能继承 UI 默认。

**最小修复：** 提议保存当前用户参考资源和受能力约束的本次参数，确认时展示并冻结，再走现有 generation-task 的引用准备/协议验证。保存输入摘要参与幂等身份，修改条件创建新步骤；不让模型拼任意付费 HTTP。

位置：[工具 schema](E:/douyin/BeefTV/agent-host/creator-bridge.mjs:22)、[持久提议](E:/douyin/BeefTV/backend/internal/app/assistant_media.go:36)、[UI 提交](E:/douyin/BeefTV/web/src/pages/canvas/creator-media-tasks.tsx:69)、[可用引用合同](E:/douyin/BeefTV/web/src/services/api/generation-task.ts:40)、[默认空引用](E:/douyin/BeefTV/web/src/services/api/generation-task.ts:251)。

### F07 · P1/P2 · 异步推进仅覆盖特定 UI 路径，续接受理前失败不重试

**正常路径替身验证通过；其余源码。** 独立生成完成后续接有真实结果检查和后端 CAS。但是逻辑在 Sidebar hook 中，剪辑助手关闭即卸载；任务可能继续，Agent 后续轮次需等再次打开。ASR、Hypit、export 没有对应事件唤醒/等待机制，只能模型轮询、保存 waiting 后用户继续。180 秒回合与 40 次工具预算限制仍在，不能假设任意长制作都能在一轮等完。

`attempted.current.add` 发生在 send 前，send 返回 false 或抛错也不移除。同一挂载实例不再自动尝试，该类 autoContinue 卡片也不提供普通手动提交按钮。UI 改为闲置/网络恢复，不足以自动解除这次本地跳过。

画布节点提议走另一条用户确认/快照/模型匹配流程，不走 allow 自动 start；system prompt 又笼统要求所有生成告诉用户确认，与独立 allow 行为不一致。画布保留不同交互可以是产品选择，但应准确表达范围，不能宣称一个模式已覆盖两区。

**最小修复：** 保存等待目标与终态续接身份，复用现有任务域/official session，覆盖 ASR、Hypit、导出。先实现应用打开时可靠的状态对账；明确关闭应用后续跑边界，再决定后台调度。send 未受理允许受控重试/“继续”，已受理必须查身份，不重发。向模型投影当前模式，画布说明明确。

位置：[自动 start](E:/douyin/BeefTV/web/src/pages/canvas/creator-media-tasks.tsx:90)、[attempted 与 send](E:/douyin/BeefTV/web/src/pages/canvas/creator-media-tasks.tsx:108)、[Sidebar 挂载](E:/douyin/BeefTV/web/src/pages/edit/project.tsx:251)、[画布提议](E:/douyin/BeefTV/web/src/pages/canvas/use-canvas-assistant-proposal.ts:36)、[通用确认措辞](E:/douyin/BeefTV/agent-host/full-control-loader.mjs:19)、[回合预算](E:/douyin/BeefTV/agent-host/server.mjs:45)。

### F08 · P1/P2 · “停止制作”未覆盖所有已交给异步运行端的任务

**源码。** Sidebar stop 执行 session stop、assistant.abort，并枚举独立生成提议取消 queued/running 生成任务。Hypit job、ASR task、导出 render 不在此枚举里；会话 abort 只结束模型/当前同步工具，已经返回 jobId 的外部 worker 仍可运行。Hypit 有独立 cancel，但没有接到这一停止入口。

通用 AppContainer 子进程取消已有真实测试；正式 Hypit 标准 build 的 cancel 也通过，但作者进程链仅 child.kill，不能据此认定任意派生子进程都已归同一 owner。本次未做 Hypit 脱离子进程测试。

**最小修复：** 每轮/工作流登记已受理执行句柄，停止根据类型调用已有取消并对账真实终态；无法上游取消时明确“已停止助手、上游仍在完成”，不要伪称全部取消。不要把其他用户手动创建的任务一并停止。

位置：[助手停止](E:/douyin/BeefTV/web/src/pages/canvas/creator-media-tasks.tsx:163)、[会话 abort](E:/douyin/BeefTV/agent-host/server.mjs:324)、[Hypit cancel](E:/douyin/BeefTV/edit-host/hypit-productions.mjs:194)、[子进程 kill](E:/douyin/BeefTV/edit-host/hypit-production-worker.mjs:13)。

### F09 · P2 · 强制退出后的导出可能永久显示 rendering/preparing

**源码 + 合成持久状态读取。** 导出状态读取只读 input/status.json，不对当前 worker 或 lease 做判断。模拟没有 worker 的旧 rendering=42% 文件，正式 savedExport/listSavedExports 仍返回 rendering。正常 close 会尝试取消；本问题针对进程崩溃、被强杀、冻结后未成功开始，未用真实用户应用强杀复现。

Hypit 同类逻辑会检查 running map，将旧 running 改 interrupted；导出没有这个对账。启动新导出需要新的 operation，旧任务没有明确恢复入口。

**最小修复：** 导出记录 worker instance/租约，启动和查询时把失活任务标为 interrupted。冻结输入继续保存；用户/Agent 可明确从该输入重试一次，输出版本与新任务身份可追溯。

位置：[导出状态](E:/douyin/BeefTV/edit-host/saved-exports.mjs:5)、[导出 worker](E:/douyin/BeefTV/edit-host/render-workers.mjs:12)、[Hypit 对账参照](E:/douyin/BeefTV/edit-host/hypit-productions.mjs:101)。

### F10 · P2 · 脚本失败状态和恢复身份不完整

**源码 + 替身桥接/包装验证。** 后端 RunResult 在非零退出时有 state=failed/exitCode；HTTP 仍正常返回业务执行结果。Creator bridge 不设置 isError，context wrapper 依据 isError 保存 completed，生命周期也显示工具完成。模型仍能读正文知道 exitCode，这不等于 UI/恢复回执准确。

workspace_run/install 的 operationId 来自 SDK toolCallId。后端同 operationId 防重真实有效，但恢复后换 toolCallId 会产生新 operationId，模型不能传入旧业务步骤身份。Runs 缺 script/runtime/args 摘要、起止时间和产物。compact identities 又未保留 assetId/exportId/state/exitCode/fileHash；工具结果文件的 resultId 没有进入该摘要。旧正文可能还在 journal，并非产物永久丢失；问题是恢复需要重新翻正文，而不是稳定引用已完成步骤。

**最小修复：** 业务失败投影 isError/明确状态；checkpoint 保留去敏产物身份和 resultId。脚本/install 接 workflowId/stepId，由服务验步骤生成持久 operation，返回请求摘要、时间、产物列表；有意重跑新增步骤，不按内容永久去重。计划 done 仍需核对真实执行状态，不能由模型 checkpoint 单独证明完成。

位置：[RunResult](E:/douyin/BeefTV/backend/internal/agentworkspace/workspace.go:516)、[桥接身份与结果](E:/douyin/BeefTV/agent-host/creator-bridge.mjs:50)、[checkpoint 投影](E:/douyin/BeefTV/agent-host/turn-context.mjs:10)、[completed 判断](E:/douyin/BeefTV/agent-host/turn-context.mjs:116)、[Runs](E:/douyin/BeefTV/backend/internal/agentworkspace/workspace.go:649)、[计划与真实任务边界](E:/douyin/BeefTV/agent-host/workflow-journal.mjs:11)。

### F11 · P2 · Agent 看不到导出的最终文件，也不能原生归档

**源码。** hyperframes_export 返回导出身份；hyperframes_exports 返回状态/进度，不返回视觉或音轨检查。edit_view/media_info 处理时间线或已导入工程素材；导出文件位于独立 exports 根。UI 有 download、媒体探测、入资产库流程，但没有 Agent 对应工具。

**影响：** 能说“导出任务完成”，不能独立证明“最终 MP4 可播放、时长/画面/音频正确”，也不能自己把导出归档并再迭代。原生预览/candidate 截图不能替代最后文件验收。

**最小修复：** 以当前工程 + exportId 提供 metadata/关键时间帧/音轨检查；提供幂等 publish-export，复用 existing resource validation 与 editing-export 身份。复查不保证审美，但至少能发现无音轨、空文件、错误尺寸/时长和关键帧问题。

位置：[导出工具](E:/douyin/BeefTV/agent-host/hyperframes-bridge.mjs:21)、[实际文件位置](E:/douyin/BeefTV/edit-host/saved-exports.mjs:14)、[现有 UI 归档](E:/douyin/BeefTV/web/src/services/edit-export-assets.ts:17)。

### F12 · P2 · 官方检查五张截图与模型图片额度冲突

**正式检查真实返回五张图；包装替身验证。** hyperframes_snapshot 固定 `--frames 5`，schema 没有 count/times。此次官方 check 同样返回五张截图。context wrapper 遇到 maxImages=1–4 或字节额度超限，会在检查已完成后把整个工具结果拒绝。错误建议“减少截图数量”，但该工具无法减少；edit_view 可读已加入工程的画面，不能直接替代尚未晋升的候选检查。

**最小修复：** 检查报告与图片分开；按模型额度抽取/缩小图片，允许逐帧读取候选。保留完整检查回执，不因图片额度丢弃成功检查信息。不扩大上游额度或静默声称已看全部画面。

位置：[固定截图](E:/douyin/BeefTV/edit-host/hyperframes-scenes.mjs:214)、[工具参数](E:/douyin/BeefTV/agent-host/hyperframes-bridge.mjs:18)、[额度拒绝](E:/douyin/BeefTV/agent-host/turn-context.mjs:100)。

### F13 · P2 · Skill 指令、依赖准备和实际执行能力未完全一致

**源码；短 JS/Python 和 Skill 热加载已运行验证。** SYSTEM_PROMPT 允许工程依赖和隔离脚本；内置 video-use/hyperframes/skill-creator 入口仍有禁止 Python/npm/install 或 helper 仅参考的旧说明。完整 927 文件不代表每个 helper 的步骤已适配。

工作区只准备 Node/npm 或 Python stdlib；PATH 没有媒体编解码器、Bash、浏览器。Video Use render helper 直接调用 ffmpeg/ffprobe，部分官方字幕 helper 是 Bash。发行脚本只明确打包 Node/npm；开发机 Python312 可用不代表用户发行包有 Python。非 Windows 明确拒绝通用脚本，这是平台限制，不是悄悄放行。

通用执行同步持有工作区锁，默认 90 秒、上限 120 秒，读目录/回执也会等待；没有脚本 job 或实时日志。长渲染应优先 native export，不能把短脚本执行当通用长任务引擎。npm 安装默认关闭生命周期脚本，对需要 postinstall/二进制依赖的包需说明支持边界，不能宣称任意 npm 包可用。

Skill 创建已有 zip/路径/元数据校验与 CAS 保存，返回 formatValidated=true、behaviorVerified=false，是诚实状态；没有成功案例到可复用步骤的自动行为验证。先增加小样例 dry-run/依赖 manifest 即可，不必上评测平台。

**最小修复：** 更新产品入口说明，把上游 helper 对应到现有 native 工具或明确 readiness；先支持确实需要的几类 helper，不原样运行整套上游安装/云服务指令。只有真实需要超过两分钟的脚本时，再复用任务域做可查询 job。

位置：[新执行指令](E:/douyin/BeefTV/agent-host/full-control-loader.mjs:24)、[Video Use 旧禁令](E:/douyin/BeefTV/agent-host/skills/video-use/SKILL.md:30)、[HyperFrames 入口](E:/douyin/BeefTV/agent-host/skills/hyperframes/SKILL.md:49)、[Skill Creator 入口](E:/douyin/BeefTV/agent-host/skills/skill-creator/SKILL.md:31)、[120 秒和 PATH](E:/douyin/BeefTV/backend/internal/agentworkspace/workspace.go:491)、[解释器准备](E:/douyin/BeefTV/backend/internal/handler/assistant_workspace.go:21)、[发行 Node/npm](E:/douyin/BeefTV/scripts/package-agent-host.mjs:56)、[技能格式/行为状态](E:/douyin/BeefTV/backend/internal/skills/hub_author.go:79)。

### F14 · P2 · 联网基础已写，但当前机器公开网页实跑被网络环境阻断

**真实只读公开页面探针 + 源码；Tavily 未用真实密钥调用。** 正式 agentweb.Read(`https://example.com/`) 返回“禁止本机、内网或保留地址”。当前 DNS 解析 example.com 和 api.tavily.com 到 `198.18.0.*` fake-IP。公开读取工具禁用环境代理并拒绝该保留网段；在这种网络设置下不能认定搜索/阅读/下载开箱可用。Tavily 自身请求走同一 PublicHTTPClient，因此有同类网络阻断风险，这是条件推断，不是实际搜索请求结果。

搜索替身测试确认 key 只发给固定 Tavily endpoint、保留实际来源、过滤私网 URL；网页支持公开 text/html/json，文本分页，下载落工作目录。没有登录页面、JS 浏览器执行或 PDF 提取，这是当前支持边界；来源引用由提示词指导 Markdown URL，没有逐项真实性校验。web_read 的失败原因被压成通用网络/HTTP错误，较难自行修复。

**最小修复：** readiness 提示 DNS/fake-IP/代理可达性，保留安全的 DNS/HTTP诊断。若支持用户代理，走显式配置并保持目标与重定向安全校验，不把保留地址全放开。普通静态网页够用后，再按用户素材来源决定是否补 PDF/浏览器。

位置：[公开搜索与读取](E:/douyin/BeefTV/backend/internal/agentweb/web.go:34)、[Public transport](E:/douyin/BeefTV/backend/internal/outbound/outbound.go:143)、[保留地址](E:/douyin/BeefTV/backend/internal/outbound/outbound.go:41)、[业务配置/下载](E:/douyin/BeefTV/backend/internal/app/assistant_web.go:80)。

### F15 · P2 · 素材内容理解有按需工具，没有内容检索索引

**源码。** assets_search 的数据库查询匹配 title/payload_json 的字符串，不是视觉/转写语义索引。Video Use 是操作方法；media_read 提供有限抽帧，media_transcribe 识别口播，不能因此说“搜产品特写”可以直接找到没有相关标签的所有素材。

**最小修复：** 先为实际读过的素材保存带时间的镜头摘要、OCR/ASR 和来源 hash；普通全文/标签检索已可能足够。真实素材量与查询证明必要后再考虑 embedding，不需要现在引入向量库。

位置：[搜索投影](E:/douyin/BeefTV/backend/internal/app/assistant_workspace.go:90)、[SQL 匹配](E:/douyin/BeefTV/backend/internal/repository/asset_library.go:135)、[工具说明的诚实边界](E:/douyin/BeefTV/agent-host/creator-bridge.mjs:15)。

### F16 · P2 · 诊断不足以解释“慢在哪里”

**源码 + 前端状态测试。** 实时事件发工具身份和 start/update/end，update 去重，不含实际进度；首字/总耗时、requests/toolSteps 已有，但 SDK input/output/cache usage、逐请求/逐工具耗时、具体重试原因、排队/网络/执行分段未进入业务回执。模型登记 cost 为 0 是占位，不能显示成实际免费。

**最小修复：** 消费 SDK 的真实 usage 和去敏时序，记录实际渠道模型、工具阶段、错误 reason 与重试；前端给长任务真实阶段/等待说明。先做小型诊断记录，不需要监控平台或钱包。

位置：[事件投影](E:/douyin/BeefTV/agent-host/lifecycle-events.mjs:6)、[更新合并](E:/douyin/BeefTV/agent-host/lifecycle-events.mjs:60)、[metrics](E:/douyin/BeefTV/agent-host/server.mjs:413)、[占位 cost](E:/douyin/BeefTV/agent-host/canvas-turn.mjs:117)。

## 已经够用的基础与暂不值得建设的内容

以下能力应接着用，不应因为闭环断点而重写：官方 Pi SDK；官方 SessionManager/journal；本地 SQLite 持久任务；已有生成提议与受理身份；工程 CAS 和原生历史/撤销；当前时间线与选区读取；长结果分页；有限抽帧与本地 Whisper；HyperFrames 固定版本候选/check/截图/导出；Skill 每轮快照和哈希更新。通过的专项验证给它们提供了有限但实在的证据。

暂不优先：多 Agent 编排、替换 Runtime、重写编辑器、复制 Codex 的全部 CLI、放开整个电脑权限、无条件装任意远程 Skill/运行安装脚本、永久记忆/独立用户风格系统、向量数据库、完整 MCP 平台、浏览器全自动化、企业审批/监控平台、把所有上游 helper 都搬进来。它们不能先解决本报告的主流程断点。

“内容理解结果索引”“长脚本后台任务”“Skill 行为验证”有价值，但应根据真实任务出现频率逐步建设，不需要把它们都作为第一条视频的前置条件。

## 最值得补的五项（排序）

成本为相对量级，不是工期承诺；按现有实现复用，修复执行边界优先。

| 排名 | 补充能力 | 用户价值 | 风险/当前问题 | 成本与最小范围 |
| --- | --- | --- | --- | --- |
| 1 | **让所有作者执行遵守同一实际边界，且可启动、可停、可恢复** | 能放心使用 Skill/作者组件 | Hypit 越界实证；E 盘脚本启动失败；错误回执 | 中；先封 Hypit 绕过、执行根 readiness、非零退出正确投影；完整 Hypit 沙箱可能更高 |
| 2 | **接完整素材输入与流转** | “自己找素材/拿参考图生成/脚本出素材后接着剪”成为真实能力 | 白名单冲突、生成 reference 和参数缺失 | 中；复用 owned asset、generation references 和 native import |
| 3 | **耐中断的异步推进与停止对账** | 等生成/ASR/制作/导出后继续，不重复或失联 | UI 生命周期、attempted、孤儿导出、未联动停止 | 中到高；复用持久任务，先应用打开时的对账/续接与句柄取消 |
| 4 | **让模型配置与协议真正进入 Runtime** | 用户配置的模型能用，容量/视觉检查匹配 | 错误 base path、Gemini/Header缺口、固定context/output、五帧拒绝 | 小到中；先预设URL和支持提示，再 canonical capability、配额友好截图 |
| 5 | **最终交付复查 + 最小诊断** | 交付可播放、有音轨、归档的成片；失败能解释 | Agent只能看导出状态；耗时/usage缺口 | 中；owned export review/publish、SDK usage/工具时序；不用监控平台 |

## 验证记录

运行材料在忽略的 `.local/cache/seal-agent-audit/`，现有测试主要用系统临时目录；没有触碰用户工作区数据、真实配置、已有剪辑工程或模型密钥。后台审查控制实验只修改审计缓存父目录权限。测试创建并关闭自己的进程；未重启用户的 Seal。

| 验证 | 实际结果 | 能证明什么 / 不能证明什么 |
| --- | --- | --- |
| `node --test edit-host/test/hyperframes-scenes.integration.test.mjs` | 1 PASS，约 29.6 秒，无 Skip | 正式 CLI 0.8.130、真实 browser check 五截图、候选入轨、版本冲突、切割后源音视频时钟、真实 MP4 音轨/音量/像素、撤销冲突；不证明真实模型创作质量 |
| `node --test edit-host/test/hypit-production.test.mjs`，配置现有 Hypit/浏览器/FFmpeg | 1 PASS，约 12 秒，无 Skip | 正式 Hypit check/plan/build、持久任务复用、真实候选、原生晋升、标准 build 取消；不证明作者任意代码隔离 |
| Go `TestAssistantLocalASRActualAssetSurvivesReopen`，现有固定 Whisper Base + JFK 测试样本 | PASS，无 Skip | 真实识别、近似 token/SRT、重开复用，任务不重复；不证明中文剪后字幕的精确词对齐 |
| Go `TestAssistantMediaConfiguredChannelReopensWithoutResubmission` | image/audio PASS | 真实后端任务、资源入库、重开防重；上游为本地替身，未验证真实收费渠道，也未包含真实视频供应商 |
| Go context/steer/permission/ASR 独立工程专项 | PASS | 后端持久与归属、上下文概要、host不能自批准、ASR输入复用；不是全流程模型运行 |
| Bun turn-context/workflow-journal/history-recovery/media-input | 9 PASS | 长结果重开读取、补充队列、官方journal工作流、断流回执、视频/音频/文本引用转换；SDK消息与上游为替身/纯函数 |
| Bun `assistant-permissions.browser.test.ts`，实际 Sidebar + 合成模型/HTTP | 1 PASS，19 断言 | ask、allow、自动续接、停止、新会话隔离的正常 UI 路径；不覆盖面板卸载、续接受理前失败和外部ASR/Hypit/export停止 |
| Bun hyperframes-bridge + canvas proposal execution + tool activity | 19 PASS | 固定 Skill 引用、冻结工程、数组/图片、确认快照、防重复提交、工具状态；画布确认有其独立防护 |
| 后台 Bun skill-hub/selected-skill/visual-input/canvas-turn | 28 PASS | Skill快照/指定入口、视觉额度、SDK状态转换；不代表全套 helper 都可执行 |
| 后台 Go workspace 路径/脚本回执/Windows AppContainer专项 | PASS | 短Node/本机Python执行、合成env不继承、工程外/其他工程/回执读写拒绝、localhost拒绝、取消子进程；TEMP默认ACL与E盘默认ACL不同 |
| 后台 Go modelcatalog/assistantruntime/workspace归属专项 | PASS | 配置投影、明确不支持协议、资源归属与发布、Key隔离；预设的带路径URL未被相邻测试覆盖 |
| 正式工作区 E盘ACL探针及单独缓存FullControl控制实验 | 复现失败 / 控制成功 | 当前目录权限会使正式脚本启动失败；未更改产品目录/真实素材权限 |
| 正式 Hypit 作者边界探针 | 复现越界：check complete、合成工程外读、另一合成回执写 | **确认漏洞，不能算安全验收 PASS**；未读取真实敏感文件 |
| `flow-probe.mjs` | 断言通过 | 替身五图片在三图片额度下拒绝；failed脚本被checkpoint为completed；恢复身份缺asset/export；正式reader接受无worker合成rendering状态 |
| `runtime-probe.mjs` | 断言通过 | 替身桥接恢复新toolCallId产生新operationId；不是实际重跑付费任务 |
| Go `./internal/agentweb` | 2 PASS | 替身Tavily鉴权/来源/私网过滤；不是实际联网搜索 |
| 正式 agentweb.Read 公开 example.com 探针 + DNS读取 | 当前网络失败，解析至198.18.0.* | 当前公开读取未可用；没有用真实Tavily Key调用，也未尝试绕过SSRF保护 |
| Go `TestEditingRoutesRequireTrustedUIOrOwnedOpenAssistantTurn` | **FAIL** | 旧测试 media/transcribe 期望403，实际503“请求协调器尚未初始化”，在范围导入断言前退出；不是实际桌面转写失败的证明，需补齐fixture并按当前转写合同更新断言 |

验证启动时曾因 Playwright 默认浏览器未安装失败，显式使用现有 Chrome 后同一专项通过；曾用错误工作目录/Node执行Bun测试、以及缓存探针import/module路径错误，修正验证命令后完成。上述工具/环境错误没有计为产品缺陷。未做整库测试/全量构建，没有新建大量模拟测试，也没有运行真实付费模型。

留存本次原生检查摘要、截图和合成成片在 `.local/cache/seal-agent-audit/native-proof/`；专项底稿和小型复现探针在审计缓存。报告的 F01/F02 实跑仅使用合成材料；F07/F08/F09 的关闭/强杀边界仍有明确的源码/替身范围，未声称真实用户任务全场景恢复已验收。

## 直接回答四个问题

### 1. 现在 Agent 距离独立完成一条视频，还差哪些环节？

基本剪辑、ASR、候选动效和导出已经有真实能力。距离稳定独立完成，主要差：

1. 找到或新发布的素材，无需用户重新 @ 就能安全导入原生工程。
2. 参考资源和本次生成参数真实送到生图/生视频/配音渠道。
3. ASR/Hypit/导出等异步步骤完成后可靠续接；暂停、重启、停止能和真实任务对账。
4. 脚本失败/产物/步骤身份可恢复，所有作者执行路径实际遵守隔离。
5. 读取最终导出文件检查、归档，再根据用户要求继续修改。

然后才是受控的真实模型端到端验收，评估其工具选择、时间映射和内容质量。不能通过注册工具数量判断完成，也不能把一个2秒合成片成功当任意视频成功。

### 2. 哪些能力看起来有，实际没有接通？

- “素材检索到剪辑”中间被起始引用范围拦住。
- “模型看到了参考图”没有接到独立生成任务的 reference payload。
- “完全允许”已覆盖独立生成提议，画布节点仍是另一条手动确认链。
- “自动续接”没有覆盖面板关闭、ASR、Hypit、导出及受理前失败恢复。
- “停止制作”没有取消所有异步句柄。
- “Skill 脚本已隔离”仅适用于通用 workspace 通道，Hypit 原生作者是另一条执行通道。
- “模型能力已配置”实际主要传视觉额度，容量/输出/推理/工具合同未完整映射；部分预设/Headers不可用。
- “完整官方 Skill 包”没有配齐 helper 所需环境，也没有统一旧禁令。
- “导出成功”没有接到 Agent 的最终文件复查与资产归档。
- “联网已接入”有真实代码，当前网络fake-IP设置下公开读取仍失败；真实Tavily调用未验证。

### 3. 最应该先修的三个问题是什么？

1. **执行边界与可用性：** 先封 Hypit 作者JS绕过；修E盘执行根/readiness及非零退出误显示完成。否则不宜把更多外部 Skill 放入运行面。
2. **素材和生成输入断点：** 接通 owned asset 导入、脚本产物入轨和 reference/逐次参数。它们直接阻断“自己完成制作”。
3. **渠道请求和能力映射：** 修方舟/智谱路径、明确原生Gemini/Header支持范围，接模型容量与配额友好截图。用户选的模型必须能实际用。

随后立即补异步续接/停止/导出恢复。这一排序不代表异步问题小，而是前三项分别影响安全、主要制作输入和模型请求入口。

### 4. 如果只再做一周，应该补什么？

一周应是补通闭环的一次迭代，不承诺同时完成完整Hypit沙箱、后台调度和全部模型协议。

| 时段 | 建议范围 | 可检查交付 |
| --- | --- | --- |
| 第1–2天 | 执行边界止血、私有执行根readiness、失败状态；修预设URL | Hypit作者不能碰合成工程外文件/回执；E盘新工程短脚本可运行；非零退出显示失败；预设请求路径正确 |
| 第3–4天 | owned资产发现→原生导入；持久生成引用与常用参数；统一Skill入口实际能力说明 | 无需用户手动补ID；参考图和时长/比例出现在最终任务输入；脚本产物可publish并入轨 |
| 第5–6天 | 优先补应用打开时ASR/导出等待续接、受理前重试、关联停止、孤儿导出识别；导出检查/归档若时间允许 | 用真实任务终态继续；不重交生成；停止可查实际未停项；重开没有永久rendering |
| 第7天 | 六条任务的有限验收、最小逐工具诊断；修复发现的回归 | 记录真实执行/替身/未验证边界；版本冲突不丢人工修改；模型能力大改与整套后台调度另开后续范围 |

若Hypit完整OS隔离超出前两天，先采用明确的安全止血范围，后续做完整隔离；不以无隔离执行换取表面可用。一周最后以一条“已有素材+转写+标题+导出”和一条“缺素材+参考生成+续接”的完整可验收链交付，真实付费模型验收需单独授权。优先修现有链路，不新增多Agent、不换Pi、不重写编辑器。
