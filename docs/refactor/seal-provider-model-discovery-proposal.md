# Seal 预设与模型发现优化建议

本次只核对源码并提出方案，不修改实现。

## 当前调用链

- `web/src/lib/model-service-presets.ts` 的预设包含基础地址、目录格式、各能力协议；多数不包含具体模型 ID。`serviceSupportsModelCatalog` 将 Claude 和 manualCatalog 列表硬性判定为不可拉取。
- `web/src/pages/settings/model-service-editor.tsx` 的 `choosePreset` 只对 Agnes、ComfyUI、原生语音预填模型。Agnes 为当前固定型号；ComfyUI 的 comfyui-image/video 是本地工作流配置名称；语音部分名称也是服务配置标识，不能都视为供应商真实型号。
- `web/src/services/api/image-models.ts` 已通过 `/ai/models` 拉取上游目录，目前以 OpenAI/Gemini 格式为主。刷新有合并保留，但没有完整的发现来源、过期状态、型号退役与能力确认流程。
- `backend/internal/generation/comfyui.go` 的 `InspectComfyUI` 已请求 `/system_stats` 与 `/object_info`。`configured-provider-editor.tsx` 用返回节点判断缺失的节点类，没有将节点输入枚举传入工作流编辑器，不能就地从服务提供的模型文件中选择。

## ComfyUI 官方接口

官方 [Server Routes](https://docs.comfy.org/development/comfyui-server/comms_routes) 与 [server.py](https://github.com/Comfy-Org/ComfyUI/blob/master/server.py) 声明：

- `GET /models` 列出模型目录类型；不是 OpenAI 的 data/model 目录。
- `GET /models/{folder}` 列出该类型的本机模型文件。
- `GET /object_info` 或单节点接口提供输入 schema，可读取模型加载节点可接受的枚举。
- `/prompt` 接收完整工作流。列出一个 checkpoint 不等于可以把它送进任意工作流。

兼容旧版本时可退回 `/object_info` 的真实字段枚举，不使用内置文件名假装本机已有模型。

## 建议

### 连接预设与目录分开

预设只提供供应商名称、地址、鉴权和调用协议；推荐型号单独标注来源和日期，不成为允许列表。用户保存的模型、音色、工作流、接口脚本和默认选择继续属于本地配置，不因目录刷新而被覆盖。

目录取得优先级：供应商实时接口 → 可更新参考目录 → 手工输入。参考目录只能补名称和已知能力，不能证明账户权限或特定渠道实际支持。鉴权失败应报真实错误，不退回参考目录伪装成功。

目录接口按供应商适配：OpenAI、Gemini、Anthropic 与供应商专用接口分别处理；没有目录接口时支持手工添加。目录为空、目录未实现、网络失败和凭证无效必须区分。新模型可发现，不自动取代默认模型。旧型号从目录消失时标注待确认，保留当前工程的引用及用户配置。

### ComfyUI 单独采用工作流视图

连接页显示“工作流”，用用户可读名称代替虚假的远端模型 ID。导入 API 工作流后，从节点 schema 查找模型加载字段，提供当前 ComfyUI 安装的 checkpoint、扩散模型、文本编码器、VAE、LoRA 下拉选择。

只更换被选中字段，保留其他输入和图连接。验证选择值属于该字段真实枚举；对架构变化或组件不匹配，提示导入匹配的工作流，不自动重写图。用户安装新模型后点“刷新本机模型”即可出现，不需要修改 Seal 代码或重新创建渠道。

### 更新方式

先做手动刷新、时间戳、目录来源、缓存与刷新失败保留。可在打开配置页时刷新过期目录，避免每次打开应用拉所有服务。图像/视频能力和协议不能仅靠模型名字猜测；不确定时标注待配置。新 API/协议需要对应执行适配更新，新型号沿用已有协议则可直接添加。

CC-switch 与 Magpie 的源码比较见相邻文件 `provider-catalog-reference-research.md`。
