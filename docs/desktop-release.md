# Seal 桌面发布

Seal 的源码和更新包使用 [wenlei-xu/Seal](https://github.com/wenlei-xu/Seal)。发布流程包含 Windows amd64、macOS arm64（Apple 芯片）和 macOS amd64（Intel）。macOS 在对应架构的 GitHub 原生构建机上打包并验证剪辑导出及本地转写，首版使用临时签名，未经过 Apple Developer ID 签名与公证。

## 客户端更新

客户端检查 `https://github.com/wenlei-xu/Seal/releases/latest/download/desktop-update.json`。公钥来自 `backend/internal/desktopupdate/seal-update-public-key.txt`，私钥不进入源码或安装包。签名清单指定版本、下载地址、大小和 SHA-256。

启动检查、每小时检查及更新日志窗口里的手动检查使用同一控制器。自动下载默认开启，可以关闭；下载完成后由用户点击“保存并重启更新”。下载支持中断续传，安装前验证签名、摘要和完整包布局。

安装前等待画布、资产、模型配置和剪辑界面已发送的保存请求，检查创作任务、内置 Agent、剪辑制作和导出状态。独立更新助手等待旧程序退出后替换程序、CLI、官方插件、agent-host、edit-host 和许可文件，失败时尝试还原旧程序。用户工程、素材、渠道凭据和用户 Skill 留在数据目录。

这是完整包更新，不提供差分更新。首次候选 ZIP 约 615 MiB。当前检查不是跨所有进程的全局事务锁；数据库迁移失败后的自动数据恢复和新版本运行健康验证还需专门完善，不能承诺任意程序降级都会恢复数据。

## 首次准备

1. 推送当前项目源码到本仓库。
2. 将 `.local/cache/seal-release/seal-media-runtime-windows-amd64.zip` 放到 `runtime-v1` 的 GitHub Release，标记为预发布且不设为 latest。它只包含固定版本的浏览器、FFmpeg 和 Whisper CPU 运行环境。
3. 设置仓库 Actions Secret `BEEFTV_UPDATER_PRIVATE_KEY`，值为本地 `.local/release-signing/seal-updater.private` 的内容。私钥需要单独备份，不能提交 Git。对应公钥已经入库。
4. 运行 `Release Seal desktop` 工作流，确认版本与 VERSION 相同，首次保持 publish=false。
5. 下载草稿中的完整包验收后，在 GitHub 中发布该草稿并设为 latest。

无需 R2、官网接口或单独服务器。运行环境 ZIP 的下载地址、大小及摘要固定在 `release/windows-runtime.json`；重新制作依赖包时必须换资产版本并同时修改摘要。不能覆盖已有资产。

## 日常发版

更新 `VERSION` 与 `SEAL_CHANGELOG.md` 对应版本条目，提交到仓库后，推送匹配的 vMAJOR.MINOR.PATCH 标签，或手动运行工作流。标签触发生成草稿；手动执行时可以明确选择 publish=true 来正式发布。

工作流在 Windows 和两种架构的 Mac 构建机上构建 Wails、前端、CLI、官方插件和两个 Node 运行端，检查 updater 合同，使用实际随包工具离线制作并导出短片。Mac 同时编译固定提交的 whisper.cpp，使用随包 Whisper Base 识别样例音频，并检查工具没有依赖构建机上的非系统动态库。三种平台全部成功后，签名并上传统一 `desktop-update.json`、三个完整 ZIP 和 SHA256SUMS。已有同名 Release 拒绝覆盖，正式版本必须高于此前稳定版本。

Mac 下载输入固定在 `release/macos-runtime.json`：Chrome 使用 Google 存储对象的固定 generation 和 MD5 校验值，FFmpeg、FFprobe、许可证及 Whisper 模型使用 SHA-256。最终三个发布包统一生成 SHA-256 并纳入签名更新清单。`scripts/prepare-seal-macos-runtime.sh` 准备本机架构的媒体环境，随后由 `scripts/build-beeftv-release.sh` 构建完整 `Seal.app`。原生构建和命令行验收不代表已经完成所有桌面交互的人工验收。

容器镜像的发布流程改为手动执行；普通源码提交不会自动发布容器产品。

## 本地构建

原有 `scripts/build-editing-preview.ps1` 和 `scripts/start-editing-preview.ps1` 继续用于开发。预览程序连接源码目录，关闭自动安装更新；用户需手动安装一次完整 Seal.exe 包，之后使用应用内更新。正式 Windows 构建使用：

```powershell
./scripts/prepare-seal-release-runtime.ps1
# 将 Node 24.15.0 根目录设置为 BEEFTV_NODE_RUNTIME。
# 将固定提交 7f730abf72fa1e4a543eed8cd1807319d9f18196 的 Hypit 仓库设置为 BEEFTV_HYPIT_ROOT。
./scripts/build-beeftv-windows-release.ps1
```

构建环境需要 Go、Bun 1.4.2、CGO 编译器。正式产物位于 `backend/cmd/desktop/build/bin`。打包维护 CLI 为 `backend/cmd/update-release`，所有包需要带 LICENSE、NOTICE 和 THIRD_PARTY_NOTICES.md。

对照源码的实现和首次运行记录见 `docs/refactor/seal-desktop-update-implementation.md`。Magpie 调研保存在 `docs/refactor/magpie-update-research.md`。
