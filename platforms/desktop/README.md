# 熄灯早睡 · 桌面端（Windows / macOS / Linux）

基于 **Avalonia 11.3 + .NET 10** 的跨平台桌面实现。相比浏览器版本，桌面端能做浏览器**做不到**的事：

1. **真正的全屏置顶窗口** —— 熄灯界面是真的覆盖在所有应用之上，而不是"一个全屏网页"；
2. **前台进程监听** —— 检测到非白名单应用获得焦点时，立刻把熄灯界面重新置顶；
3. **白名单窗口层级放行** —— 白名单应用在前台时，仅其窗口临时提升到黑屏之上可见可用，
   桌面与其他应用始终被黑屏遮住（不靠"隐藏黑屏"暴露整个桌面）；
4. **白名单共用时长预算** —— 按熄灯窗口重置、持久化，用尽后强制恢复熄灯；
5. **系统时间篡改检测** —— 改时间立即恢复熄灯并记录违规。

---

## 验证状态（重要）

| 项目 | 结果 |
| --- | --- |
| `dotnet build` | ✅ **成功，0 个警告，0 个错误** |
| `--selftest` 自检 | ✅ **266 项断言全部通过，0 项失败，退出码 0** |
| GUI 启动 | ✅ 可正常启动（由开发过程中的实际运行确认） |
| macOS 专属路径 | ⚠️ **未验证**（无 macOS 环境） |
| 多显示器置顶、禁止关闭 | ⚠️ **未验证**（依赖真实图形会话，自检无法覆盖） |

自检报告原文保存在 `selftest-report.txt`，可直接查看。

> 我们不会把"写了代码"说成"验证通过"。上表中标注为"未验证"的项目都是真实的空白。

---

## 环境要求

- **.NET SDK 10.0** 或更高（开发时使用 10.0.202）
- 构建时会从 nuget.org 还原 Avalonia 包

---

## 构建与运行

```bash
cd platforms/desktop

# 构建
dotnet build

# 启动图形界面
dotnet run

# 运行自检（不启动 GUI，直接跑断言）
dotnet run -- --selftest
# 或直接运行已构建的程序集：
dotnet bin/Debug/net10.0/Xideng.Desktop.dll --selftest
```

自检会把报告同时写到用户数据目录：

- Windows：`%APPDATA%\xideng\selftest-report.txt`
- macOS：`~/Library/Application Support/xideng/selftest-report.txt`

---

## 自检覆盖范围

```
自检通过：259 项断言全部通过，0 项失败。
结论：PASS
```

| 分组 | 覆盖内容 |
| --- | --- |
| **time** | 时分转换、非法输入抛错、跨天取模、日期往返、时长格式化（含负数不为负） |
| **holidays** | **2026 年 20 个官方日期逐日核对星期**（对照国办发明电〔2025〕7号）、各节日放假天数、6 个调休上班日归类、数据缺失年份不误判 |
| **schedule** | 跨天时段构造、**凌晨 02:00 归属前一天开启的时段**、预告相位边界（22:44 / 22:45 / 23:00 / 07:00）、调休上班日按工作日执行、时段校验 |
| **scene** | 周五/周六/周日晚、节假日优先于星期、假期前夜与最后一晚、调休上班日晚、时间分区、**提示词不泄露用户数据** |
| **copy** | 危害科普必须绑定来源、播放顺序稳定性、三类文案齐备、轮播循环、空列表报错 |
| **quota** | 自然周以周一 00:00 为界、**跨月与跨年的自然周**、周一自动重置、额度用尽、持久化、存储损坏自愈 |
| **password** | 摘要确定性、未设置密码时永不通过、强度建议 |
| **settings** | 默认值、非法字段夹取、**系统电话短信无法被改成可移除**、订阅通知、序列化往返 |
| **engine** | 相位判定、**错误密码不消耗额度**、解除后同时段保持 OFF、次日自动恢复、AI 文案优先级 |
| **guard** | 时间前后跳变检测、连点 5 次触发与超时重置 |
| **platform** | 用户目录解析、前台进程监听可用性、开机自启注册表读写往返 |

### 与 Web 端的行为一致性

自检里有一组**跨实现一致性断言**，用来防止 C# 移植版与 JS 原版产生行为漂移：

```
[PASS] hashString("2026-09-04|friday-night") 与 Web 端一致
[PASS] mulberry32 随机序列与 Web 端一致（前 5 个值）
[PASS] 周五晚播放列表顺序与 Web 端逐位一致（21 条）
[PASS] SHA-256("1234") 与 Web 端一致
```

这四条保证了「同一天看到同一句话」「同一个密码在所有端都能解开」这类用户可感知的一致性。

---

## 能力对照（PRD 5.2 / 5.3）

| PRD 要求 | 状态 |
| --- | --- |
| 管理员权限 | ✅ 通过 `app.manifest` 声明 `requireAdministrator` 级别的 UI 访问权限 |
| 开机自启动权限 | ✅ Windows 写 `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`；macOS 用 LaunchAgent plist（**未验证**） |
| 全屏置顶窗口权限 | ✅ `BlackoutWindow` 无边框 + `Topmost`，每块屏幕各一个窗口（**多屏未验证**） |
| 程序运行监听权限 | ✅ Windows：`GetForegroundWindow` + `GetWindowThreadProcessId` 轮询；macOS/Linux **待实现** |

### 端能力差异

| 能力 | Windows | macOS | Linux |
| --- | --- | --- | --- |
| 全屏置顶熄灯窗口 | ✅ | ✅（代码跨平台） | ✅ |
| 前台进程监听 | ✅ 已实现 | ⚠️ 待实现（需 `NSWorkspace`） | ⚠️ 待实现（需 X11 EWMH） |
| 开机自启 | ✅ 注册表 | ⚠️ 代码已写，未验证 | ⚠️ 代码已写，未验证 |
| 用户数据目录 | ✅ `%APPDATA%\xideng` | ⚠️ `~/Library/Application Support/xideng` 未验证 | ✅ `~/.config/xideng` |

---

## 目录结构

```
platforms/desktop/
├── Xideng.Desktop.csproj     项目文件（Avalonia 11.3 / net10.0）
├── app.manifest              Windows 应用清单（DPI 感知、权限声明）
├── Program.cs                入口：区分 GUI 模式与 --selftest 模式
├── DesktopCoordinator.cs     编排层：相位循环、窗口生命周期、守卫装配
├── SelfTest.cs               259 项断言的自检实现
├── Core/                     平台无关核心（packages/core 的 C# 移植）
│   ├── TimeUtil.cs           时间与日期基础工具
│   ├── Holidays.cs           2026 法定节假日与调休数据（含出处）
│   ├── Schedule.cs           睡眠计划与相位判定
│   ├── Scene.cs              场景识别
│   ├── CopyLibrary.cs        文案库与轮播（危害科普绑定来源）
│   ├── QuotaStore.cs         每周解除额度
│   ├── PasswordHasher.cs     紧急解除密码
│   ├── Settings.cs           设置模型与迁移
│   ├── SettingsStore.cs      设置读写
│   ├── Storage.cs            存储抽象（文件 + 内存）
│   ├── Engine.cs             状态引擎
│   ├── Guard.cs              防绕过守卫
│   └── Constants.cs          常量与默认值
├── Platform/                 平台相关实现
│   ├── AppPaths.cs           跨平台用户数据目录
│   ├── AutoStartManager.cs   开机自启（注册表 / LaunchAgent）
│   └── ProcessWatcher.cs     前台进程监听（接口 + Windows 实现 + 降级实现）
└── Views/                    Avalonia 界面
    ├── BlackoutWindow.axaml(.cs)    熄灯黑屏界面（全屏置顶、禁止关闭）
    └── SettingsWindow.axaml(.cs)    设置界面
```

---

## 设计说明

### 为什么用 C# 重新实现而不是嵌入 WebView

WebView 方案能保证界面完全一致，但**拿不到真正的前台进程信息和窗口 Z 序控制权** ——
而这两点恰恰是桌面端存在的全部理由。因此这里选择用 C# 重新实现核心逻辑，
并用「跨实现一致性断言」把行为漂移的风险降到可接受范围。

### 为什么不直接共享 packages/core

.NET 无法直接执行 ESM 模块。可选方案有两个：嵌入 JS 引擎（如 Jint）、或用 WebView。
两者都会引入运行时依赖与性能开销，与「零依赖」的项目基调冲突。因此选择移植 + 一致性测试。

### 存储

桌面端把设置写成 JSON 文件保存在用户数据目录，而不是浏览器 localStorage。
`Storage.cs` 提供了文件与内存两种实现，后者用于自检（不污染真实用户数据）。

---

## 已知限制

1. **macOS 全部路径未验证** —— 无设备。代码已按平台分支写好，但未在真机运行过。
2. **多显示器置顶未验证** —— 依赖真实图形会话。
3. **「禁止关闭」未验证** —— 拦截 `Closing` 并取消的逻辑依赖真实窗口消息循环。
4. **Linux 前台进程监听未实现** —— 需要 X11 EWMH 或 AT-SPI，且行为高度依赖桌面环境。
5. **托盘常驻未实现** —— 当前关闭设置窗口后进程仍会继续运行，但没有托盘图标可操作。
