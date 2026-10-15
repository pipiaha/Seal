# BeefTV 后续更新与 Seal 移植建议

调研日期：2026-10-14（北京时间）。范围为官方源码、发布记录及当前 Seal 源码，不修改实现、不提交或推送，也不调用真实模型。下文的“缺口”表示源码对比确认的差异或风险，不表示已经在用户机器复现全部故障。

## 1. 比较起点和版本范围

- 当前 Seal：`643b6367a37a3c6d16fb54fd92378aadbe4303ec`，版本 `v1.7.8`。
- Seal 重置提交历史前的开发分支：`5039327fa24117700e1be724943966c484055c35`。本地归档 `history.bundle` 保留其祖先。
- 该分支与当前 BeefTV 主分支的 `git merge-base` 为 `4ca2a65a7780a8dfcaaa86c33679f84fb04e055c`，提交时间为北京时间 2026-10-05 00:29，其 VERSION 为 `v1.7.7`。因此比较起点确实是 BeefTV v1.7.7，而不是与 Seal 相同编号的 BeefTV v1.7.8。
- 最新正式版本为 [BeefTV v1.7.21](https://github.com/glanderness/BeefTV/releases/tag/v1.7.21)，标签指向 `bb5999e4339892ec9cae55f8ba3de26d78f214cb`，GitHub API 显示北京时间 2026-10-14 14:01:36 发布，非草稿、非预发布。
- 调研时主分支为 `a1cdb9a44133132855dd08d6b43b6ac6f0f5cf4a`，北京时间 2026-10-14 20:41 合入。它比正式标签多了 Pi 1.2.0、FAL H3 和画布复制／拖动优化等提交；不能把这些都说成 v1.7.21 已发布能力。

官方事实来源：[GitHub Releases](https://github.com/glanderness/BeefTV/releases)、[固定主分支的 CHANGELOG](https://github.com/glanderness/BeefTV/blob/a1cdb9a44133132855dd08d6b43b6ac6f0f5cf4a/CHANGELOG.md)、[起点提交](https://github.com/glanderness/BeefTV/commit/4ca2a65a7780a8dfcaaa86c33679f84fb04e055c)。发布元数据和隔离源码检出保存在 `.local/cache/beeftv-upstream-review-2026-10-14*`；未为 Seal 主仓库添加上游远程或合并分支。

## 2. 起点后的全部正式版本

| 版本 | 主要变化（归纳） | 对 Seal 的判断 |
| --- | --- | --- |
| [1.7.8](https://github.com/glanderness/BeefTV/releases/tag/v1.7.8) | 视频声音参数的类型兼容、预览崩溃修复；Windows 下载校验句柄修复 | 视频类型处理值得移植；Windows 可写校验句柄在 Seal 已修复 |
| [1.7.9](https://github.com/glanderness/BeefTV/releases/tag/v1.7.9) | Seedance 真人档位、报价与刷新时档位保护 | 官方报价／账号档位无需接入；通用“刷新不替换用户模型配置”原则保留 |
| [1.7.10](https://github.com/glanderness/BeefTV/releases/tag/v1.7.10) | Seedance 真人型号展示名称整理 | 不属于 Seal 当前优先事项，不导入托管型号别名体系 |
| [1.7.11](https://github.com/glanderness/BeefTV/releases/tag/v1.7.11) | 图片生成前确认目标节点持久化；生成成功但未回填时恢复原成果 | 高优先级，手动画布生成链路存在对应差异 |
| [1.7.12](https://github.com/glanderness/BeefTV/releases/tag/v1.7.12) | Seedance 名称合并和报价展示 | 托管相关，暂不需要 |
| [1.7.13](https://github.com/glanderness/BeefTV/releases/tag/v1.7.13) | 更换官方账号入口；助手多模态、持久执行、权限、技能安装、旁白字幕与本地渲染 | 多项能力 Seal 已另行接入；仅比较恢复和操作保护实现，不替换我们的剪辑与 Skill Hub |
| [1.7.14](https://github.com/glanderness/BeefTV/releases/tag/v1.7.14) | 无输出时恢复、大画布分页、模型切换；画布退出保存、首帧不制造编辑、资源引用保护、MCP 及模型搜索 | 画布保存和资源保护值得筛选；助手能力逐项验差异，不能按名称重复建设 |
| [1.7.15](https://github.com/glanderness/BeefTV/releases/tag/v1.7.15) | Windows 兼容视频预览、同任务视频结果取回；素材引用交互、历史懒加载、草稿恢复、Linux 包 | 预览与交互修复有价值；Linux 排在 Mac 后；官方备用视频接口不能硬接到通用渠道 |
| [1.7.16](https://github.com/glanderness/BeefTV/releases/tag/v1.7.16) | 字幕窗口接入云端 ASR，保留本地识别；ASR 与配音分类分开、避免未知提交重发 | Seal 已有本地／在线 ASR 后端和助手工具；可补画布字幕窗口自动转写入口，无需绑定官方账号 |
| [1.7.17](https://github.com/glanderness/BeefTV/releases/tag/v1.7.17) | 结果下载进度和续传、局部回填、恢复与停止；排队不消耗重试；Mac 全屏、模型大目录、诊断、删除确认、安装器与会话迁移 | 最有价值的一批通用稳定性更新；需要分模块适配 |
| [1.7.18](https://github.com/glanderness/BeefTV/releases/tag/v1.7.18) | H3 Max Turbo、首尾帧及配音；图片加载失败有可见重载入口 | 取图片错误／重载 UX；H3 专属报价和托管合同按用户需求再做 |
| [1.7.19](https://github.com/glanderness/BeefTV/releases/tag/v1.7.19) | 更新准备进度、减少重复解压、修复保存阻塞；Windows 安装重试和错误说明；减少动态效果下模型菜单可用 | 更新可靠性高优先级；安装器需与我们的完整包布局适配 |
| [1.7.20](https://github.com/glanderness/BeefTV/releases/tag/v1.7.20) | H3/H3 Max、2K/4K 和多媒体参考；深度任务超时和重启恢复 | 深度恢复按实际功能使用率安排；通用音频上传／结果解析修复值得筛选，H3 非当前第一优先 |
| [1.7.21](https://github.com/glanderness/BeefTV/releases/tag/v1.7.21) | 优先取上游视频结果，下载失败／停滞后用同一任务备用文件，取消结束下载 | 借鉴执行语义；具体备用地址依赖 BeefAPI，不能直接应用到 Agnes、ComfyUI 和任意自定义 HTTP |

发布说明是范围线索，以下建议同时读取了相关提交和 Seal 调用链。未下载安装上游各版，也没有把上游发布声明当成 Seal 的运行验证。

## 3. 最值得移植的五组更新

### A. 生成节点持久化和结果回填保护：最高优先级

上游 [#90](https://github.com/glanderness/BeefTV/pull/90) 增加 `persistCanvasGenerationTarget`：发送生成前确认目标节点已保存；保存期间的删除、画布切换、作用域变化会阻止继续提交。成功结果未回填时保留原任务，而不是把故障当成“没生成成功”。[#123](https://github.com/glanderness/BeefTV/pull/123) 进一步把回填改为局部操作并清理旧全量写入口。

Seal 证据：

- `web/src/pages/canvas/canvas-image-generation-executor.ts:184` 开始登记前端请求，随后调用生成；没有上游新增的目标持久化依赖。
- `web/src/lib/canvas/canvas-project-generation.ts:129` 的 `runCanvasGenerationTaskToConsumer` 没有先等待目标节点保存的步骤。
- `web/src/services/local-workspace-repository.ts:462`、`:525` 仍调用完整画布 PUT；`backend/internal/handler/user_data.go:601`、`:634` 仍注册旧写入口。
- 我们已有 revision、确认快照、操作日志和作用域保护，因此不是“完全没保存机制”；问题是生成前保存、生成后回填仍有两套路径，不能把已有保护当成已经完成这次上游修复。

最小方向：对手动画布生成增加“保存目标成功才提交”；结果应用只提交相关节点、连线和资产，不用旧完整快照覆盖人工或助手刚发生的编辑；保留 taskId 和可恢复结果。

成本：中高。需要联动人工生成、结果恢复、画布 repository 和后端写入合同，不能只复制 helper 文件。首批验证应覆盖保存失败不提交、切画布不误回填、生成完成后人工移动仍保留、失败恢复不重复提交。

### B. 视频／图片结果下载和继续取回：最高优先级

上游 [#123](https://github.com/glanderness/BeefTV/pull/123)、[#134](https://github.com/glanderness/BeefTV/pull/134)、[#146](https://github.com/glanderness/BeefTV/pull/146) 分别补齐资源续传、生成中的下载反馈、同任务备用文件。

Seal 证据：

- `backend/internal/app/task_delivery.go:303` 交付远程资源时仍调用整体读取的 `downloadRemoteResource`；实现位于 `backend/internal/app/resource.go:347`。
- `backend/internal/generation/http.go:113` 的 `GetProviderExternalBinary` 仍是一次 GET + `DoBinary`；没有此次上游新增的下载状态／续传链路。
- Seal 已有 `RecoverIncompleteGenerationDeliveries`（`task_delivery.go:31`）和任务输出记录，不能说恢复能力不存在；它仍需要补“已经生成，但素材还在下载”的细分状态、进度、取消与续传。

最小方向：在现有 taskId／交付回执下保存下载阶段、字节进度和可继续信息；下载完成再回填；支持取消下载和再次取回。上游的 `X-Beeftv-Video-Delivery`、`/videos/{id}/content?delivery=backup` 是 BeefAPI 专属约定。Seal 应通过现有 Provider/自定义 HTTP 的查询或 result 接口获得新下载地址，不能给所有供应商发送这个 Header 或调用这个路径。

成本：中高；用户价值很高。对大视频和国内网络尤为有用。验证必须用断流／过期地址夹具确认只恢复下载，没有重新 POST 生成。

### C. 画布视频预览、布尔值、复制节点与拖动：高优先级

正式版修复：[v1.7.8/#83](https://github.com/glanderness/BeefTV/pull/83)、[Windows 兼容预览 #105](https://github.com/glanderness/BeefTV/pull/105)、[图片失败重载 #138](https://github.com/glanderness/BeefTV/pull/138)。另有尚未随 v1.7.21 发布的 [#149](https://github.com/glanderness/BeefTV/pull/149)。

Seal 证据：

- `web/src/components/canvas/canvas-node-content.tsx:558` 仍对 `metadata.generateAudio` 直接调用 `.trim()`；真实 JSON 可能是布尔值，类型声明无法保证旧文件和工具入参都为字符串。上游新增 `parseVideoBoolean/normalizeVideoBoolean` 并用于读取和配置归一化。
- `backend/internal/app/playback_adapter.go:19` 未向 playback 注入随包工具路径；`backend/internal/playback/service.go:34` 默认 `exec.LookPath`，`backend/internal/playback/transcode.go:23` 执行 PATH 上的 `ffmpeg`。Seal 虽然在 `edit-host/media/ffmpeg` 打包了 FFmpeg，画布播放兼容副本的这条链路并不会因此自动用到它。
- `web/src/pages/canvas/use-canvas-render-model.ts` 没有 #149 新增的 `visibleNodesRef/displayConnectionsRef` 引用稳定处理；节点 comparator 仍会受非必要回调变化影响。
- `web/src/lib/canvas/canvas-project-generation.ts` 没有 `clearInPlaceMediaOutputMetadata`；复制后原地生成可能继续携带旧资源 ID、预览、时长等信息。我们的生成器有保留旧内容的逻辑，因此要区分“有意保留上一版”与“把上一版误当成新结果”。

最小方向：先做布尔参数和随包 FFmpeg 接线，再对多视频画布与复制节点采用 #149 的思路，保留 Seal 自己的历史／回退语义。图片失败要显示可点击的重载入口。

成本：布尔修复低，兼容预览中，拖动／复制优化低到中。#149 只改善无限画布，不等同于解决 HyperFrames 时间线拖动卡顿；后者需要单独量测。没有运行性能对比，不能给出帧率或卡顿减少比例。

### D. 更新准备进度和安装恢复：高优先级

上游 [#136](https://github.com/glanderness/BeefTV/pull/136)、[#135](https://github.com/glanderness/BeefTV/pull/135)，随 [v1.7.19](https://github.com/glanderness/BeefTV/releases/tag/v1.7.19) 发布。

Seal 证据：`backend/internal/desktopupdate/engine.go:298` 在下载后解压一次；`backend/internal/desktopupdate/helper.go` 准备 helper 时再次调用 `extractSecureZip`。我们的完整包约 621 MiB，重复解压和缺少准备进度会让用户误以为卡住。前端 `web/src/services/desktop-update.ts:222` 也会等待各类保存，需要区分真实未保存修改与以前失败的队列残留。

最小方向：更新校验、保存、解压和准备安装都显示阶段与进度；消除下载阶段的冗余展开，安装阶段保留签名／摘要／布局检查；保存失败时显示来源并允许重试。迁移目录用户的更新重启需要继续使用同一数据目录。Windows 目录占用重试和安装失败恢复一并评估。

已有能力：`backend/internal/desktopupdate/http.go:326` 已用 `os.O_RDWR` 校验，Windows 刷盘句柄修复无需再移植。签名、摘要、下载续传和 `edit-host` 整包更新已实现，必须保留。

成本：中。不能直接覆盖上游目录清单：其侧包叫 `media-runtime`，我们的 `edit-host` 内还包含 Hypit、HyperFrames 和 ASR。要基于 Seal 布局验证升级及回滚。

### E. 通用协议与素材交互修复：按需接入，排在以上之后

- [#144](https://github.com/glanderness/BeefTV/pull/144) 随正式 v1.7.21 已包含：`audio/mpeg` 的上传文件名显式使用 `.mp3`；Responses 协议插件从真实 `output[].content[].text` 提取文字，而不是只等快捷 `output_text`。Seal 的 `backend/internal/generation/helpers.go` 仍按系统 MIME 扩展名表选第一个，`plugin-packages/openai-responses/manifest.json` 的插件返回规则仍主要取 `output_text`。Go 的直连文字路径已有 `ExtractResponseText`，所以这是“插件路径仍需补齐”，不是所有 Responses 都不能用。助手经 Pi 的路径也应另行区分。
- 素材引用菜单的失焦、穿透、键盘导航（[#107](https://github.com/glanderness/BeefTV/pull/107)）和图片失败 UX：我们已有部分事件保护，要按具体交互核对后取小补丁。
- 模型大目录和“减少动态效果”下的选择菜单：值得参考通用部分；Seal 的五类渠道页和脚本编辑器已与上游分叉，保留现有页面结构。
- 字幕页自动转写：Seal 已有本地 Whisper Base、在线 OpenAI 兼容 ASR 及助手工具；`canvas-subtitle-dialog.tsx` 仍以导入、编辑和导出字幕为主，可增加调用现有 ASR 的按钮。不需要为了这个接回 BeefTV 账号。

成本：单个通用协议修复低到中；字幕入口低到中。应优先选用户已经在用的协议，别把托管型号与报价合同整套搬入。

## 4. 已具备或暂不值得追的更新

| 更新方向 | Seal 当前情况 | 建议 |
| --- | --- | --- |
| 多模态、执行中补充、历史恢复、工具过程 | 现有 Pi host、会话持久化、视觉输入、队列和工具详情已接入 | 针对具体故障比较恢复方案；不因上游又做了一版而换掉自己的助手 |
| Skill 安装和启停 | Skill Hub、手动选择、冻结轮次快照已有 | 保留现有合同；关注技能跨轮持续使用，不重复建 Hub |
| 思考参数和更大输出 | `agent-host/output-policy.mjs` 已有 49152 缺省输出和 reasoning 映射，官方 Session 设置思考级别 | 上游“开启思考”不是我们缺失的功能 |
| Pi 1.2.0 + Durable | 主分支 [#143](https://github.com/glanderness/BeefTV/pull/143) 已合入，但不在正式 v1.7.21 标签；我们固定 0.87.1 | 独立兼容评估，关注 session、事件、技能和工具 API；不能只改版本号，暂不列第一批 |
| BeefTV 登录／钱包／Seedance 报价 | Seal 采用用户自配渠道，旧内置渠道已移除 | 不迁入；这些不是当前产品需要追的功能 |
| H3 系列与 FAL 全能力 | 正式版有托管 H3；主分支 [#145](https://github.com/glanderness/BeefTV/pull/145) 另加 FAL。我们的自定义 HTTP、JavaScript 参数、ComfyUI 能提供扩展入口 | 有实际用户需求再加预设和模型能力；是否可用仍需真实供应商协议验证 |
| Mac／Linux 安装器 | 上游已发 macOS arm64/amd64 的 DMG、Windows setup.exe 和 Linux deb；Seal 当前只发完整 Windows ZIP | Mac 是有价值的后续阶段，但不能复用上游成品包；仍需 Seal 的剪辑／ASR 随包运行环境和 Mac 实机验收。Linux 后排 |
| 深度动作捕捉恢复 | 上游修复长任务等待和重启恢复 | 使用率足够时移植；不优先于主生成／剪辑流程的结果取回 |

## 5. 迁移顺序和边界

建议分三批：

1. 小而明确的修复：视频布尔值、复制节点清理、随包 FFmpeg 接线、MP3 命名和 Responses 插件解析；另测多视频画布拖动引用稳定性。
2. 完整可靠性流程：生成前保存目标、局部结果应用、交付进度与续传、恢复不重复生成；同步前后端版本合同及相邻测试。
3. 更新准备和安装恢复，之后做 Mac 完整包。Pi 1.2.0 是单独评估任务，不与上述数据写入改动同时升级。

不要把上游主分支整包 merge 进来。起点至调研主分支的差异涉及 916 个文件，包含新 Agent 运行时、托管模型、界面、协议插件文档和平台安装器，不能以文件数量推断全部都是新功能。Seal 的独立剪辑、Hypit/HyperFrames、Skill Hub、渠道脚本、生成权限和更新签名需要保留。按修复问题和实际依赖摘取实现，记录原作者与来源。

这轮没有修改业务实现、替换依赖、运行付费调用、做性能测试或执行 Mac 打包。实际进行了官方发布元数据查询、隔离上游源码读取、历史 bundle 祖先验证、相关提交 diff 与当前源码调用链对照。结论是移植优先级建议，不是移植完成或跨平台验收证明。
