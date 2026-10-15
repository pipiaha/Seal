# Seal 模型目录与 ComfyUI 模型选择实现

## 已接通

- 供应商预设与用户模型选择分开：管理页与渠道列表提供目录刷新，新增型号不自动启用；已有模型、默认选择、参数、脚本和工作流保留。
- 目录以用户 scope 和连接摘要隔离，保存到 IndexedDB；重新打开配置可恢复。显示读取时间，超过一天提示建议刷新。失败保留旧目录，空列表不会删除用户模型。
- 未声明类型的条目可以加入当前类别；以前发现、现在消失的型号标记「目录未再列出」，手工型号不误标为下架。
- Anthropic 原生目录、Gemini 原生分页、OpenAI 兼容目录、指定鉴权头、无鉴权，以及同站点自定义目录路径接入 `/ai/models`。拒绝跨站点目录与重定向。读取最多 20 页、单页 8 MiB，总时间 25 秒。
- Agnes 解除目录入口的硬性限制；未提供目录的服务继续手填，也可设置供应商提供的目录接口。预填型号只是初始值，不是允许列表。
- ComfyUI 管理页直接显示工作流，不再要求先进入另一个模型协议弹窗。读取 `/object_info` 的加载节点枚举，提供 checkpoint、扩散模型、文本编码器、VAE、LoRA 等真实文件选择。更换文件更新图中的输入与对应字段值，保留连线；缺失文件显示提醒。
- 节点参数编辑器同步使用实际枚举；工作流显示名称、导入/导出、能力参数与测试入口保留。

## 实现位置

- `web/src/lib/channel-model-discovery.ts`：发现目录、用户选择、未分类与消失条目的合同。
- `web/src/services/channel-model-catalog-cache.ts` / `web/src/hooks/use-channel-model-catalog.ts`：按用户与连接缓存、通知、旧请求与 scope 保护。
- `web/src/pages/settings/model-service-editor.tsx` / `channel-settings-pane.tsx`：刷新与管理入口。
- `web/src/lib/comfyui-model-selection.ts` / `configured-provider-editor.tsx`：实例枚举、模型选择与真实图输入更新。
- `backend/internal/app/channel_model_discovery.go` / `channel_model_catalog.go`：真实目录 HTTP、分页、鉴权、地址和大小边界。
- `backend/internal/modelcatalog/catalog_fetch.go`：目录格式和元数据解析。

## 验证

### 已实际执行

- 前端 TypeScript 检查与生产构建通过。
- `comfyui-model-selection.test.ts`、`model-service-presets.test.ts`、`model-discovery.browser.test.tsx` 共 18 项通过。浏览器使用实际 React/AntD 组件，API 为本地替身；验证模型选择写入可执行工作流、连线保留、目录重新打开恢复、未知型号显示、刷新失败保留和手工参数保护。
- Go `modelcatalog` 与 `app` 的目录专项通过：原生协议解析、分页与鉴权、空列表、跨站点目录及凭证重定向拒绝。
- 本地预览可执行文件已编译，检查嵌入前端入口与构建一致；不是正式发布包。

### 已知基线问题

运行完整 `channel-model-catalog.test.ts` 时，三个旧测试仍期待恢复已退场的 `beefapi` 渠道，因此失败：

1. `keeps the fetched BeefAPI catalog dynamic while normalizing discovered image profiles`
2. `maps BeefAPI speech and music to audio without treating ASR as chat or TTS`
3. `preserves an explicitly configured BeefAPI text protocol`

把配置 store 模块替换为当前 HEAD `643b636` 的原始源码后，这三个测试产生相同失败，确认不是本次模型发现变更引入。没有为了通过旧测试恢复退场渠道，也没有跳过它们。其余本次专项通过。

## 范围与实际限制

- 没有使用真实密钥、提交生成或执行 GPU 工作流；供应商账号权限与真实本机模型兼容性仍需用户环境验证。
- 目录来自供应商，不证明账号一定能调用；无目录的服务仍需手填或配置其列表路径。没有用公共资料库伪造供应商支持情况。
- 本次采用手动刷新与过期提示，没有静默轮询所有服务，也没有自动下载或更换本机模型。
- ComfyUI 基于节点 schema 支持模型选择；不同模型架构、缺失自定义节点仍需要匹配的工作流。视频/音频专用素材上传能力没有在本次扩展。
- 未提交、推送或发布。

## ComfyUI 界面简化

- 取消 ComfyUI 的 Seal 配置包导入、导出，只留「导入工作流／更换工作流」，接收 ComfyUI 的 API JSON。
- 主界面只显示连接地址、测试连接、工作流名称、模型和常用数值参数。鉴权与自定义请求头收进「连接选项」，完整节点图、字段绑定和输出字段默认折叠。
- 测试连接读取本机模型选项；导入工作流时尚未读取则自动检查。连接与读取共用一次请求，切换地址或关闭时取消旧请求。普通画布 JSON 给出明确格式提示。
- 尽可能沿采样器的正向输入确定提示词；无法判定时显示选择，避免覆盖负向文本。模型和常用参数更改同时更新图输入与字段默认值。
- `InspectLocalComfyUI` 增加 15 秒截止时间，并将连接拒绝、鉴权、地址和超时转成可读提示。先运行失败用例复现原始 `*url.Error` 未分类，再修复并确认通过。
- 两项 Go 检查、三项浏览器交互及两项模型选择测试通过；前端类型检查、生产构建和本地预览编译通过。浏览器使用本地 API 替身，不代表已在真实 GPU 环境执行工作流。

### JSON 输入

增加「导入文件 / 粘贴 JSON」两种输入，共用 API 工作流解析、提示词与输出识别。本次没有恢复 Seal 配置包导入、导出，也没有增加助手生成工作流入口。已保存工作流可以在高级设置编辑 JSON；语法错误与取消不替换原配置，编辑保留未变节点的绑定。编辑未应用时禁用渠道保存并明确提示先应用或取消。新增浏览器验证覆盖粘贴、错误提示、再次编辑及参数和绑定持久化；4 项目录/工作流浏览器测试通过。
