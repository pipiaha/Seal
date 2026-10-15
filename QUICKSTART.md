# Seal 快速开始

Seal 是本地 AI 视频创作工作台，提供画布、独立剪辑工程、创作助手和 Skill Hub。项目、素材、模型配置及用户 Skill 保存在本机。

## 下载与启动

从 [Seal Releases](https://github.com/wenlei-xu/Seal/releases) 下载对应系统的完整包。Windows 选择 `windows-amd64`；Mac 的 M 系列芯片选择 `darwin-arm64`，Intel 选择 `darwin-amd64`。`runtime-v1` 是构建依赖，GitHub 的 Source code 压缩包是源码，都不是应用安装包。

解压后保留整个目录，启动 `Seal.exe`。旁边的 `agent-host`、`edit-host`、`cli`、`plugin-packages` 和许可证文件都是运行所需内容。

Mac 解压后将 `Seal.app` 放入“应用程序”，再启动。Mac 为首个发行版本，使用临时签名，尚未经过 Apple Developer ID 签名与公证；确认来自本仓库后，可按系统“隐私与安全性”中的提示允许首次打开。

## 配置模型

进入“模型配置”，按需要配置文字、图片、视频、语音和 ASR 渠道，再选择默认模型及助手模型。密钥保存在本地工作区，不要提交到 Git 或附在问题报告里。

本地 Whisper Base 可用于离线转写。图片、视频和配音等外部模型调用使用你配置的供应商，其费用由对应服务计收。

## 开始创作

- 在画布中生成和整理素材。
- 在“剪辑”中新建独立工程，从文件或资产库导入素材，编辑、预览并导出。
- 打开创作助手，用自然语言操作当前工程；输入 `/` 或点击技能按钮选择已启用的技能。
- 在 Skill Hub 导入、查看、启停或删除自己的技能。

## 数据与更新

Windows 默认工作区位于 `%AppData%\Seal`。已有 BeefTV 工作区按兼容逻辑继续读取，具体位置以应用实际选择的目录为准。备份时先保存工作并退出应用，再完整复制工作区，包含数据库、素材和配置。

正式完整包可以在应用中检查 Seal 的 GitHub 更新。源码开发预览关闭自动安装；先手动安装正式完整包后再使用应用内更新。

## 源码开发

准备环境和运行端后，在仓库根目录执行：

```powershell
./scripts/build-editing-preview.ps1 -BuildWeb
./scripts/start-editing-preview.ps1
```

前置条件、隔离数据目录和正式构建见 [桌面开发](docs/desktop-local-development.md) 与 [桌面发布](docs/desktop-release.md)。完整文档入口为 [Seal 文档](docs/index.md)。
