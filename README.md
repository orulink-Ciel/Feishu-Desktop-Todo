# 轻列便签

Windows / macOS 常驻待办小窗口，展示飞书当前用户任务，完成后回写飞书。React + Tauri 2 + Rust + SQLite。首版复用飞书 CLI 的用户授权，无需业务服务器。

开发以 [需求与开发方案](docs/需求与开发方案.md) 为准。构建、自动测试、真实 API 和手工验收分别记录在 [开发与验收记录](docs/开发与验收记录.md)。

![应用图标](public/app-icon.png)

图标采用折页便签与完成勾，原始图和再生成步骤见 [图标设计](docs/图标设计.md)。

## 使用

内部试用安装包通过 [GitHub Releases](https://github.com/orulink-Ciel/Feishu-Desktop-Todo/releases) 提供：Windows x64 安装程序、Apple 芯片 Mac 和 Intel Mac 的 DMG。首次设置与分发边界见 [打包与试用发布](docs/打包与试用发布.md)。安装包附带飞书 CLI 原生程序，不需要 Node.js、Rust 或额外安装 CLI；新机器仍需配置飞书应用并完成用户授权。

本公司 Windows 同事使用 Release 中带 `internal-windows-x64` 的安装包，它包含值日来源配置；三个通用包不预设公司值日来源。所有安装包均不包含飞书登录凭证，读取值日表需要相应组织权限。

0.1.2 起支持应用内更新：启动后检查，每 6 小时再检查，设置中可手动检查。用户点击后下载安装并重启，更新包验证签名，公司版与通用版分别更新。旧版本需要先手动安装一次；发布流程见 [自动更新](docs/自动更新.md)。

- 今天：今天到期、此前到期和本机固定到今天的任务。
- 全部：查看其他未完成任务；点击图钉固定到今天，不改飞书日期。
- 点击标题：优先直接唤起飞书客户端任务详情；系统无法唤起时回退网页。任务行右侧来源图标可打开文档或业务来源。
- 完成：先显示提交中，再以飞书读回状态确认。结果待确认时请刷新。
- 多人或签：需要确认完成整个任务；多人会签请在飞书完成个人份额。
- 顶部图钉：窗口置顶。拖动左上标题可移动窗口，边缘可调整大小；正常退出后自动保存位置和大小，下次启动恢复。如果原位置已不在连接的显示器内，回到默认居中位置。
- 底部设置：选择 2、5 或 10 分钟同步（默认 5 分钟），或重新授权飞书。旧版 30/60 秒设置会自动升级为 5 分钟。
- 顶部调色盘（或设置 → 外观主题）：切换轻序（日出纸页）、日行（日历路径）、桌序（错层纸页）。点击即时生效，主题在本机保存，重启后保留。
- 值日卡片：读取公司飞书多维表格，按大小周及官方节假日日历显示今日值日人员；支持请假代班、两天互换以及 14 天排班预览，可单独刷新，或打开“值日制度”“名单与规则”“排班与调整”。名单留空、规则未启用时显示“值日未配置”。管理员在飞书填写人员、顺序、起始日期和例外，修改配置需在飞书由管理员完成。

公司管理入口由管理员在本地构建配置中填写，公开仓库不提供内部链接。首次使用值日功能需要 `base:record:read` 用户授权；应用“重新授权飞书”已包含该范围。字段 ID 与表 ID 在构建时固定，不允许普通用户在应用中更换来源。

本地缓存位于 Tauri 当前用户应用数据目录中 `com.personal.feishu-desktop-todo/tasks.db`。飞书凭证由 CLI 自己管理；本项目不读取凭证文件，不把令牌交给前端。断网显示缓存和上次更新时间，不会离线伪造完成。

## 开发

要求 Node.js 22 和 Rust stable。Windows 使用 MSVC、Visual Studio C++ Build Tools 和 WebView2；macOS 使用 Xcode Command Line Tools。在对应系统构建，CLI 原生程序架构与运行系统一致。

```powershell
cd Feishu-Desktop-Todo
npm ci
```

源码仓库不包含 CLI 二进制文件。依赖锁定 `@larksuite/cli@1.0.76`；下面命令使用官方安装器校验下载，并复制当前平台程序与许可证，不复制凭证：

```powershell
npm run prepare:cli
```

公司值日来源采用本地构建配置。复制示例后填写自己的文档地址、Base token、表 ID 和字段 ID：

```powershell
Copy-Item src-tauri\duty-config.example.rs src-tauri\duty-config.local.rs
```

字段映射见 [值日制度方案](docs/值日制度方案.md)。本地配置不提交 Git，重建后生效；公开仓库不包含公司的实际链接或人员名单。飞书应用配置和授权由 CLI 管理，新机器需单独完成配置与登录。

打开实际桌面程序：

```powershell
npm run desktop
```

浏览器界面预览使用独立示例数据，清楚标注为预览，操作不会写入飞书：

```powershell
npm run dev
```

## 验证和构建

```powershell
npm test
```

```powershell
cargo test --manifest-path src-tauri\Cargo.toml
```

```powershell
npm run package
```

`package` 保留本地公司值日配置；通用分发使用 `npm run package:public`，强制采用示例配置。打包需要原更新签名密钥与密码，环境变量设置见发布说明；普通源码验证可使用 `npm run tauri -- build --no-bundle`。GitHub Actions 分别构建 Windows 通用、Windows 公司、Apple 芯片 Mac 与 Intel Mac 包，输出签名更新包、安装包及 SHA-256 校验文件。

真实读取测试需要本机有效授权，不会修改飞书任务：

```powershell
cargo test --manifest-path src-tauri\Cargo.toml live_read -- --ignored --nocapture
```

`live_roundtrip` 是专门的真实写入测试，仅允许已创建的验证任务 A，需显式设置测试 GUID；不应针对工作任务运行。普通自动测试不会访问飞书。

## 首版分发边界

当前交付是个人内部试用构建。新机器的 CLI 应用配置、面向全公司的独立 OAuth 分发、开机启动、托盘、提醒、离线写入和桌面任务编辑不属于本版。桌面组件是普通可置顶小窗口，不修改 Windows Explorer 桌面层或极序数据。

CLI 原生程序由 MIT 许可的 `@larksuite/cli` 提供，许可证随资源一并保存。
