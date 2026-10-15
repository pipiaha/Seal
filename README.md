<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/seal/lockup-white.svg">
  <img src="assets/seal/lockup-black.svg" width="320" alt="seal">
</picture>

### 从想法到视频，在一个工作台里完成。

**用画布创作素材，用轨道完成剪辑，让 Agent 参与每一步。**<br>
图片、视频、配音和字幕，用你自己选择的模型与渠道。<br>
工程和素材留在本机，常用的创作方法留在 Skill 里。

[![Windows](https://img.shields.io/badge/Windows-桌面版-111111)](https://github.com/wenlei-xu/Seal/releases)
[![macOS](https://img.shields.io/badge/macOS-Apple_Silicon_%26_Intel-111111)](https://github.com/wenlei-xu/Seal/releases)
[![License](https://img.shields.io/badge/License-MIT-111111)](LICENSE)

**[下载](https://github.com/wenlei-xu/Seal/releases)** · **[快速开始](QUICKSTART.md)** · **[文档](docs/index.md)** · **[更新日志](SEAL_CHANGELOG.md)** · **[反馈](https://github.com/wenlei-xu/Seal/issues)**

</div>

https://github.com/user-attachments/assets/74f79004-6807-4ea6-80c1-7a54e5ec7b2d

## 为什么做 Seal

做一条视频，经常要在聊天、生图、生视频和剪辑工具之间来回切换。素材散在不同地方，提示词写了又写，最后还要重新整理才能开始剪辑。

Seal 把这些环节放进同一个工作台：在画布里探索画面，把素材放进资产库，再进入独立剪辑工程。你可以自己动手，也可以让创作助手读取工程、调用技能、完成具体操作。

## 你可以用它做什么

| | |
| --- | --- |
| **🎨 画布创作** | 把参考图、文字、图片和视频放在一起，用节点和连线组织创作流程，继续生成和修改。 |
| **✂️ 轨道剪辑** | 新建独立工程，从文件或资产库导入图片、视频和音频，调整片段、切割、预览和导出。 |
| **💬 创作助手** | 对着当前工程说需求。助手读取内容并调用工具，实时展示执行进度，保留对话和改动记录。 |
| **🧩 Skill Hub** | 导入自己的技能，查看说明、启用或停用；用 `/` 或技能按钮指定这次要使用的方法。 |
| **🔌 模型渠道** | 分别配置文字、图片、视频、语音和 ASR，按用途选择模型。支持预设供应商与自定义兼容服务。 |
| **📁 本地素材** | 用资产库集中管理创作素材；本地 Whisper Base 把音视频转成带时间信息的文字。 |

### 一张画布，慢慢把想法做出来

先摆参考，再写提示词，生成几种方向，然后挑出想继续做的那个。画布负责创作和组织素材；进入剪辑后，时间线负责安排它们如何出现。

画布里的基础编辑与独立剪辑工程分开，资产库连接两者。最终导出的视频也可以保存到资产库，继续用于后续创作。

### 一位助手，理解你正在做的事

选择片段或引用素材，再告诉助手要改什么：

> “把这一段切成两个镜头。”<br>
> “给开头做一个标题飞入的动效。”<br>
> “识别这段口播，找出需要调整的位置。”

助手可以读取工程、编辑片段、制作动效候选、检查场景并提交导出任务。工具状态会实时显示，已有对话和任务记录可以继续查看。需要生成付费素材时，先确认生成方案，再调用你配置的渠道。

### 常用的方法，写成 Skill

广告分镜、口播剪辑、视频分析、动效制作，都可以由技能提供步骤和参考。Skill Hub 支持本地导入和热加载，新技能在后续回合生效。

内置 HyperFrames、Video Use 和 Skill Creator 等技能。你也可以让助手把反复使用的制作方法整理成自己的 Skill，随后修改说明或选择启停。

### 模型由你来选

文字、图片、视频、语音与 ASR 分开管理，各自使用合适的供应商。选择预设，填写地址和凭据，再选择需要的模型；也可以接入自定义兼容渠道。

不同视频服务的输入、参数和结果格式由渠道配置处理。工程和素材保存在本机；调用外部模型时，按服务需要发送相关输入，费用由对应供应商计收。

## 开始使用

1. **下载完整包。** 从下表或 [Seal Releases](https://github.com/wenlei-xu/Seal/releases) 选择与你的系统对应的应用包。
2. **添加模型。** 在“模型配置”中添加需要的渠道，选择默认模型和创作助手模型。
3. **开始创作。** 新建画布，或在“剪辑”里新建工程、导入素材。需要帮助时打开创作助手。

| 系统 | 下载 v1.7.9 | 启动方式 |
| --- | --- | --- |
| Windows 64 位 | [Windows 完整包](https://github.com/wenlei-xu/Seal/releases/download/v1.7.9/Seal-v1.7.9-windows-amd64.zip) | 完整解压，运行 `Seal.exe`，保留整个目录 |
| macOS · Apple 芯片（M 系列） | [Mac Apple 芯片完整包](https://github.com/wenlei-xu/Seal/releases/download/v1.7.9/Seal-v1.7.9-darwin-arm64.zip) | 解压，将 `Seal.app` 放入“应用程序” |
| macOS · Intel | [Mac Intel 完整包](https://github.com/wenlei-xu/Seal/releases/download/v1.7.9/Seal-v1.7.9-darwin-amd64.zip) | 解压，将 `Seal.app` 放入“应用程序” |

Mac 为首个发行版本，尚未经过 Apple Developer ID 签名与公证；首次打开可能需要在系统“隐私与安全性”中允许打开。`runtime-v1` 是构建依赖，GitHub 的 Source code 是源码，都不是应用安装包。详细说明见 [快速开始](QUICKSTART.md)。

完整发行包通过本仓库 GitHub Releases 检查更新。下载并校验后，由你保存工作并确认重启安装；源码开发预览关闭自动安装。

## 从源码运行

桌面使用 **React / TypeScript + Wails / Go**，创作助手使用官方 pi SDK，剪辑复用 HyperFrames Studio。构建前需要准备相应编译工具和固定版本的媒体运行端。

```powershell
./scripts/build-editing-preview.ps1 -BuildWeb
./scripts/start-editing-preview.ps1
```

环境准备见 [桌面开发](docs/desktop-local-development.md)，正式打包见 [桌面发布](docs/desktop-release.md)，目录职责见 [仓库结构](docs/repository-layout.md)。

## 贡献与来源

问题和建议欢迎提交到 [Issues](https://github.com/wenlei-xu/Seal/issues)。参与开发前请阅读 [贡献指南](CONTRIBUTING.md)；安全问题请按 [安全策略](SECURITY.md) 私下报告。

Seal 基于 [BeefTV](https://github.com/glanderness/BeefTV) 修改，并包含来自 [Infinite Canvas](https://github.com/basketikun/infinite-canvas) 的代码。感谢原项目及各第三方组件的作者。当前 Git 历史从 Seal 源码快照开始，代码来源与原作者版权继续保留。

项目代码适用 [MIT 许可证](LICENSE)。第三方组件、素材、技能和运行端分别遵循自己的许可，完整说明见 [NOTICE](NOTICE) 与 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
