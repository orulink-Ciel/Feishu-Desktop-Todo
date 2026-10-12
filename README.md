# 飞书桌面待办

Windows 常驻待办小窗口，展示飞书当前用户任务，完成后回写飞书。React + Tauri 2 + Rust + SQLite。首版复用飞书 CLI 的用户授权，无需业务服务器。

开发以 [需求与开发方案](docs/需求与开发方案.md) 为准。构建、自动测试、真实 API 和手工验收分别记录在 [开发与验收记录](docs/开发与验收记录.md)。

## 使用

这是源码仓库，便携程序和安装包在本地构建，不随 Git 上传。构建后的 Windows 程序附带飞书 CLI 原生程序；新机器仍需配置飞书应用并完成用户授权。程序不包含任何 CLI 应用配置或用户凭证。

- 今天：今天到期、此前到期和本机固定到今天的任务。
- 全部：查看其他未完成任务；点击图钉固定到今天，不改飞书日期。
- 点击标题：优先直接唤起飞书客户端任务详情；系统无法唤起时回退网页。任务行右侧来源图标可打开文档或业务来源。
- 完成：先显示提交中，再以飞书读回状态确认。结果待确认时请刷新。
- 多人或签：需要确认完成整个任务；多人会签请在飞书完成个人份额。
- 顶部图钉：窗口置顶。拖动左上标题可移动窗口，边缘可调整大小；正常退出后自动保存位置和大小，下次启动恢复。如果原位置已不在连接的显示器内，回到默认居中位置。
- 底部设置：选择 2、5 或 10 分钟同步（默认 5 分钟），或重新授权飞书。旧版 30/60 秒设置会自动升级为 5 分钟。
- 顶部调色盘（或设置 → 外观主题）：切换雾蓝、暖纸、墨夜、深海、暮紫、素白。点击即时生效，主题在本机保存，重启后保留。
- 值日卡片：读取公司飞书多维表格，按大小周及官方节假日日历显示今日值日人员；支持请假代班、两天互换以及 14 天排班预览，可单独刷新，或打开“值日制度”“名单与规则”“排班与调整”。名单留空、规则未启用时显示“值日未配置”。管理员在飞书填写人员、顺序、起始日期和例外，修改配置需在飞书由管理员完成。

公司管理入口由管理员在本地构建配置中填写，公开仓库不提供内部链接。首次使用值日功能需要 `base:record:read` 用户授权；应用“重新授权飞书”已包含该范围。字段 ID 与表 ID 在构建时固定，不允许普通用户在应用中更换来源。

本地缓存位于当前 Windows 用户应用数据目录中 `com.personal.feishu-desktop-todo/tasks.db`。飞书凭证由 CLI 自己管理；本项目不读取凭证文件，不把令牌交给前端。断网显示缓存和上次更新时间，不会离线伪造完成。

## 开发

要求 Node.js、Rust MSVC 工具链、Visual Studio C++ Build Tools 和 WebView2。

```powershell
cd Feishu-Desktop-Todo
npm ci
```

源码仓库不包含 CLI 二进制文件。先安装飞书 CLI，按照 CLI 指引配置自己的飞书应用，然后复制运行文件与许可证到构建资源目录：```powershellnpm install -g @larksuite/clilark-cli config init --new```

```powershell
.\scripts\prepare-cli.ps1
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

真实读取测试需要本机有效授权，不会修改飞书任务：

```powershell
cargo test --manifest-path src-tauri\Cargo.toml live_read -- --ignored --nocapture
```

`live_roundtrip` 是专门的真实写入测试，仅允许已创建的验证任务 A，需显式设置测试 GUID；不应针对工作任务运行。普通自动测试不会访问飞书。

## 首版分发边界

当前交付是个人内部试用构建。新机器的 CLI 应用配置、面向全公司的独立 OAuth 分发、开机启动、托盘、提醒、离线写入和桌面任务编辑不属于本版。桌面组件是普通可置顶小窗口，不修改 Windows Explorer 桌面层或极序数据。

CLI 原生程序由 MIT 许可的 `@larksuite/cli` 提供，许可证随资源一并保存。
