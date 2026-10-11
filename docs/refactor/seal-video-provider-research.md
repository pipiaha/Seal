# Seal 视频 Provider 与本地 ComfyUI 调研

日期：2026-10-11。范围：为视频渠道通用化设计核对第一方源码，不修改实现，不提交或推送。

验证性质：本报告核对源码、配置合同和官方文档；没有真实生成测试，没有使用密钥，没有付费调用，没有启动 ComfyUI。源码存在某条调用链不代表已在用户机器验证成功。

## 固定的源码版本与许可证

- 参考仓库 `tigerowo/infinite-canvas`，`main`：`0a5e3b0b619eb11f7806e1ee28e658e4679a2bc5`。
- ComfyUI `Comfy-Org/ComfyUI`，`master`（默认分支以 API 返回为准）：`7f7fd918ed0815c5d5ef2ccfe44bfc8e72cfd217`。
- Seal 本地核对时 HEAD：`00a5d91edb19180413b5f29c798e873911c624be`。已有未跟踪 `assets/seal/marketing/`，未修改。

**指定的 tigerowo 分支是 AGPL-3.0，不是 MIT。** 根 LICENSE 为 GNU Affero General Public License v3；README 也明确标注。本文只参考架构与公开接口，不复制其代码或配置模板。不能把另一个 Infinite Canvas 上游的 MIT 标记套到这个分支上。[固定版本 LICENSE](https://github.com/tigerowo/infinite-canvas/blob/0a5e3b0b619eb11f7806e1ee28e658e4679a2bc5/LICENSE)

## 参考项目的实际实现

### 1. 自定义渠道不仅是换 Base URL

渠道保存 `id/name/protocol/baseUrl/apiKey/models/modelCapabilities`；原生协议枚举中有 OpenAI、Gemini、MiniMax、APIMart、KIE、Ark、AutoDL、RunningHub、ComfyUI 等。普通模型渠道和工作流渠道分开筛选。[渠道结构](https://github.com/tigerowo/infinite-canvas/blob/0a5e3b0b619eb11f7806e1ee28e658e4679a2bc5/model/setting.go#L16) · [协议枚举](https://github.com/tigerowo/infinite-canvas/blob/0a5e3b0b619eb11f7806e1ee28e658e4679a2bc5/web/src/lib/model-channel.ts#L1)

它另有按真实模型名配置的 `parameterTranslation`：用受限 JavaScript 对象描述提交方法、URL、Headers、查询参数、Body、编码、响应类型和结果提取；异步接口还描述任务 ID、查询方法、状态路径、成功/失败值及进度。素材输入包括图片、视频、音频、首尾帧，结果支持 URL/Data URL/二进制。结果路径支持同步选择函数。它不是完全任意脚本运行器：源码对结构和执行时间做限制。

精确来源：

- [作者配置说明及可用变量](https://github.com/tigerowo/infinite-canvas/blob/0a5e3b0b619eb11f7806e1ee28e658e4679a2bc5/web/src/lib/channel-parameter-translation.ts#L1)
- [浏览器 Worker 转译、请求编码、响应解包](https://github.com/tigerowo/infinite-canvas/blob/0a5e3b0b619eb11f7806e1ee28e658e4679a2bc5/web/src/services/api/channel-parameter-translation.ts#L65)
- [后端 Goja 校验与执行](https://github.com/tigerowo/infinite-canvas/blob/0a5e3b0b619eb11f7806e1ee28e658e4679a2bc5/service/model_parameter_translation.go#L42)
- [视频入口优先匹配转译配置](https://github.com/tigerowo/infinite-canvas/blob/0a5e3b0b619eb11f7806e1ee28e658e4679a2bc5/web/src/services/api/video.ts#L127)

限制：一个地址和 Key 无法保证任意视频服务可用；没有匹配转译规则的模型会回到内置协议。表单中素材 URL 不会自动变成文件。协议特有的上传、签名、多阶段任务仍需执行器支持。参考项目同时有登录代理和未登录浏览器直连，不能把它的 accountProxy/云端收费逻辑直接套进 Seal 的本地工作区。

### 2. 本地 ComfyUI 是真实 Bridge 实现，不只是赞助商宣传

`WorkflowEntry.provider` 实际支持 `runninghub | comfyui`，工作流区分图像/视频/音频，字段映射含 `nodeId/classType/fieldName`，把提示词、参考媒体、尺寸、时长、随机种子等产品输入映射到工作流节点。[工作流合同与字段分类](https://github.com/tigerowo/infinite-canvas/blob/0a5e3b0b619eb11f7806e1ee28e658e4679a2bc5/web/src/lib/workflow-channel.ts#L1)

完整调用链：

1. 前端提交 `/api/v1/workflow-tasks`，后端按工作流引用核对所有权与能力。
2. ComfyUI 渠道进入 Bridge 持久队列；RunningHub 进入独立云服务实现。Bridge 由本机程序注册设备、领取和续租任务。
3. 本机 Bridge 通过 `/object_info` 读取节点定义，准备 API JSON。它也尝试把普通画布 JSON 转为 API JSON，转换依赖节点信息，不能保证所有第三方节点兼容。
4. Bridge 上传参考图片到本地 `/upload/image`，POST `/prompt`，持久保存 `prompt_id`，每 1.5 秒查询 `/history/{prompt_id}`。
5. 结果保留 filename/subfolder/type 等信息，通过本地结果服务代理 `/view`。前端把 `http://127.0.0.1:8189/outputs/...` 识别为 Comfy 输出，可继续预览/读取。

来源：

- [服务端分流](https://github.com/tigerowo/infinite-canvas/blob/0a5e3b0b619eb11f7806e1ee28e658e4679a2bc5/service/workflow_task.go#L90)
- [Bridge 注册、设备、任务租约](https://github.com/tigerowo/infinite-canvas/blob/0a5e3b0b619eb11f7806e1ee28e658e4679a2bc5/service/comfy_bridge.go#L24)
- [本机提交及历史查询](https://github.com/tigerowo/infinite-canvas/blob/0a5e3b0b619eb11f7806e1ee28e658e4679a2bc5/canvas-agent/native/comfy-bridge/main.go#L545)
- [工作流 JSON 转换](https://github.com/tigerowo/infinite-canvas/blob/0a5e3b0b619eb11f7806e1ee28e658e4679a2bc5/canvas-agent/native/comfy-bridge/workflow.go#L148)
- [图片上传](https://github.com/tigerowo/infinite-canvas/blob/0a5e3b0b619eb11f7806e1ee28e658e4679a2bc5/canvas-agent/native/comfy-bridge/media.go#L132)
- [本地结果代理，包含 Range 支持](https://github.com/tigerowo/infinite-canvas/blob/0a5e3b0b619eb11f7806e1ee28e658e4679a2bc5/canvas-agent/native/comfy-bridge/output_server.go#L79)

恢复实现保存 `submitting/submitted` 和 `prompt_id`；提交期间中断且没有 ID 时停止，避免重复提交。[Bridge 恢复](https://github.com/tigerowo/infinite-canvas/blob/0a5e3b0b619eb11f7806e1ee28e658e4679a2bc5/canvas-agent/native/comfy-bridge/recovery.go#L545)

**没有核到 Bridge 调用 `/ws`、`/interrupt` 或 `/queue` 的实现。** 前端 `AbortSignal` 是停止等待，不等于停止 ComfyUI 上游计算；不能把该项目的停止能力认定为完整。它的本地输出仍依赖 Bridge/Comfy 服务及原文件，不能直接当作 Seal 已归档的资产。[前端等待循环](https://github.com/tigerowo/infinite-canvas/blob/0a5e3b0b619eb11f7806e1ee28e658e4679a2bc5/web/src/services/api/workflow-generation.ts#L108)

## ComfyUI 官方 API 核对

下表来自固定版本 `server.py`，不是第三方 Cloud/RunningHub/AutoDL API。官方概览也列出基础路由，但具体版本差异应以服务器实现为准。[官方路由概览](https://docs.comfy.org/development/comfyui-server/comms_routes)

| 接口 | 核实的用途与实现限制 |
| --- | --- |
| `POST /prompt` | 提交 API 格式节点图，验证后排队，返回 `prompt_id/number/node_errors`；普通可视化编辑器 JSON 不能原样提交。当前版本允许可选 UUID `prompt_id`，但此处未验证重复 UUID 幂等提交，不能把客户端 ID 当防重复保证。 |
| `GET /ws?clientId=...` | 执行进度事件；用 client ID 关联会话，用 prompt ID 关联任务。事件不等于持久结果；重连应查队列/历史，不盲重提。 |
| `GET /history/{prompt_id}` | 恢复/最终结果读取；未出现不等于失败，还可能在排队、运行，或历史已清理。 |
| `GET /view?filename=...&subfolder=...&type=output` | 按产物描述读取文件。输出节点字段和媒体格式受原生/自定义节点影响，需要配置明确输出节点与提取规则。 |
| `POST /upload/image` | multipart 图片上传，返回 Comfy 服务器文件名等；不要把客户端绝对路径直接当远程节点输入。视频/音频上传支持需按版本与插件核对，不能假设此端点保证任意媒体。 |
| `GET /object_info` | 节点类与输入定义，用于依赖、字段及枚举校验；不能证明 GPU/显存足够，也不保证工作流实际能跑。 |
| `GET /queue` | 查询 running/pending。 |
| `POST /queue {delete:[prompt_id]}` | 删除匹配的待执行任务。不要用 clear 清空其他来源的队列；这不是运行中停止。 |
| `POST /interrupt` | 当前版本传 `prompt_id` 时先匹配当前运行任务；不传时仍是全局中断。旧版本不应假定支持定向 body。当前实现是先读取队列后调用全局 interrupt，存在检查与中断之间状态切换的可能，不能宣称原子定向。 |
| `POST /api/jobs/{job_id}/cancel` | 当前版本新增统一定向取消：运行任务使用 `interrupt_if_running(prompt_id)`，待执行使用按 ID 删除；已结束/未知任务返回 `cancelled:false`。源码说明此运行中检查是原子的，优先于上述快照匹配方案；用户安装的旧版本可能没有该路由。 |

精确源码： [WebSocket](https://github.com/Comfy-Org/ComfyUI/blob/7f7fd918ed0815c5d5ef2ccfe44bfc8e72cfd217/server.py#L330)、[上传](https://github.com/Comfy-Org/ComfyUI/blob/7f7fd918ed0815c5d5ef2ccfe44bfc8e72cfd217/server.py#L525)、[读取文件](https://github.com/Comfy-Org/ComfyUI/blob/7f7fd918ed0815c5d5ef2ccfe44bfc8e72cfd217/server.py#L577)、[节点定义](https://github.com/Comfy-Org/ComfyUI/blob/7f7fd918ed0815c5d5ef2ccfe44bfc8e72cfd217/server.py#L866)、[Job 定向取消](https://github.com/Comfy-Org/ComfyUI/blob/7f7fd918ed0815c5d5ef2ccfe44bfc8e72cfd217/server.py#L1010)、[历史/提交](https://github.com/Comfy-Org/ComfyUI/blob/7f7fd918ed0815c5d5ef2ccfe44bfc8e72cfd217/server.py#L1111)、[队列/中断](https://github.com/Comfy-Org/ComfyUI/blob/7f7fd918ed0815c5d5ef2ccfe44bfc8e72cfd217/server.py#L1219)。

## Seal 当前可复用的基础与断点

以下是本地源码核对，不能当作本次实现完成：

- `backend/internal/protocol/types.go` 已有 `GenerationRequest/OutputOptions`，`ManifestProvider` 已有 `Create/Poll/Cancel/Result`、响应字段路径和状态映射。因此自定义 HTTP 可以复用现有声明式协议/registry，不需要另造第二套 JS 执行系统。
- `backend/internal/provider/workflow/types.go` 与 `client.go`、`web/src/stores/use-config-store.ts` 已有 RunningHub 工作流 JSON 和节点字段绑定；可作为通用工作流模型的基础，但当前执行器识别的是 RunningHub，不等于已有本地 ComfyUI。
- `backend/internal/generation/executor.go:217` 的 `validatePreparedInput` 强制 BaseURL/APIKey/Model 均非空，需改为按鉴权类型校验，否则原生不需要 Key 的 ComfyUI 被挡住。
- `web/src/stores/use-config-store.ts:984` 的 `resolveModelChannel` 在匹配不到后会回到 `config.channels[0]`。显式选择的渠道消失/无效时应报错，不允许静默向其他渠道提交。
- `backend/internal/outbound/outbound.go` 当前默认拒绝 loopback/private/link-local，已有精确允许主机机制。ComfyUI 需提供明确本地连接策略；不能为所有自定义 HTTP/网页读取关闭检查。

## 推荐设计（尚未实现）

统一任务调度，保留三类适配器：普通云 API、声明式自定义 HTTP、本地 ComfyUI 工作流。画布/剪辑/Agent 都使用同一生成入口和资产输出，不各自重写协议。

### 渠道与模型

渠道管理地址和连接：名称、Base URL、鉴权方式（Bearer/自定义 Header/none）、密钥引用、启停状态。模型管理执行协议与能力：文生/图生/首尾帧/参考视频/音频、尺寸/时长/数量限制，以及参数与媒体转换规则。渠道名字、模型名字与协议是三个不同概念；预设是可修改的默认值，不是根据模型名猜供应商。

普通用户选预设后填地址/Key即可；高级配置提供请求/查询/结果字段、状态映射的表单或 JSON 导入，校验后保存为现有 ManifestProvider。单靠 BaseURL 无法覆盖签名、专用上传等复杂协议，这些保留独立适配器。

### 本地 ComfyUI

Seal 本身有本地 Go 后端，直接连接已启动的 ComfyUI 即可；第一版不要求另装 Bridge。Bridge 是未来云网页访问用户本地设备时才需要的边界。

配置示例流程：选择“本地 ComfyUI” → 默认 `http://127.0.0.1:8188`（可改）→ 测试连接和节点信息 → 导入 **API 格式工作流 JSON** → 绑定提示词/参考图片/时长/尺寸/seed → 选择明确输出节点 → 保存为可选制作模型。一个工作流呈现为一个模型选项；不能用 `/models` 的 checkpoint 名字直接代表可执行流程。

第一版聚焦已经安装好 ComfyUI、模型和依赖的用户。连接检查报告缺少节点/模型、字段不匹配；不在 Seal 内打包 Python/GPU 环境或自动下载模型。视频/音频输入按工作流实际上传需求接入，未支持的类型明确提示。

执行：先上传素材并替换节点输入，保存工作流快照与输入摘要，再提交；得到 prompt ID 立即落库。实时进度可接 WebSocket，历史/队列查询作为断线和重启恢复依据。产物下载至 Seal 管理的本地文件，经媒体探测确认后入资产库，保留来源任务、输出节点与素材关联，不只保存可失效的 localhost URL。

### 稳定性与错误信息

- 显式 channelId 必须匹配；不能隐式 fallback 到 BeefAPI 或任意第一条渠道。
- 每个任务固定渠道、协议版本、工作流版本与字段绑定快照；密钥仅保存引用，不写入任务日志正文。恢复查询固定原上游，不使用用户后来切换的默认渠道。
- 区分未提交/已受理/提交结果不明；未知提交不自动重提。可查询 prompt ID 时继续查询；没有 ID 时据证据报告，而不是笼统宣称“模型服务不可用”。
- 显示脱敏渠道名、实际请求域名/路径、HTTP 状态、上游请求 ID、错误类型与可操作建议。
- 取消首先使用当前服务器明确支持的定向 job cancel；旧版本只删自己的 pending ID，运行中停止需有可靠能力或明确专用实例约定。停止本地等待不得谎报上游已停止。
- 自定义连接是否允许本地由显式配置与运行模式决定；无认证的本地 ComfyUI 可以使用 HTTP。不要把公网 API Key 不必要地带到 localhost 或文件下载域名。

最小实施顺序：①严校验渠道与可诊断任务回执；②现有 Manifest 的高级自定义渠道配置、按协议鉴权；③原生 ComfyUI API工作流导入、字段绑定、提交/恢复/资产归档；④WebSocket进度与按版本定向取消。以上均为建议，尚未改代码或真实验证。
