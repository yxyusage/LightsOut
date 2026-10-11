# 熄灯早睡 · Android 端

Kotlin + AndroidX 的原生实现。这是**唯一能真正做到 PRD 第三节「防绕过安全防护体系」**的形态：
设备管理员防卸载、无障碍服务拦截前台应用、前台服务保活、开机自动恢复。

---

## ⚠️ 验证状态：本工程未编译验证

**必须说清楚**：这份代码是在一个**没有 Android SDK、且 Maven Central（repo.maven.apache.org）不可达**
的环境中编写的，因此：

| 项目 | 状态 |
| --- | --- |
| Gradle 构建 / 编译 | ❌ **从未执行过** |
| 真机或模拟器运行 | ❌ **从未执行过** |
| 单元测试 / 仪器测试 | ❌ 未编写、未执行 |
| 静态自查：manifest 声明的组件是否都有对应源文件 | ✅ 已自查通过（13/13） |
| 静态自查：manifest 引用的资源是否存在 | ✅ 已自查通过 |

Maven Central 不可达意味着 Gradle **无法解析 AGP、AndroidX、Kotlin 标准库**，
连「能不能编译」这一步都无法开始。这不是"暂时没跑"，而是本环境根本不具备条件。

**因此：本工程应当被当作"一份完整但未经编译验证的实现"来看待。**
首次构建时很可能需要修掉若干编译错误。我们选择如实标注，而不是含糊其辞地宣称"已完成"。

---

## 环境要求（在具备条件的环境中构建）

- **JDK 17**（AGP 8.6.1 要求）
- **Android SDK Platform 34** + Build-Tools 34
- 可访问 Google Maven 与 Maven Central 的网络

---

## 构建步骤

```bash
cd platforms/android

# 1. 指定 SDK 路径
echo "sdk.dir=/path/to/Android/Sdk" > local.properties

# 2. 构建 Debug APK
./gradlew assembleDebug          # Windows: gradlew.bat assembleDebug

# 3. 安装到设备
./gradlew installDebug
```

> 仓库中没有提交 Gradle Wrapper 的 `gradle-wrapper.jar`（二进制文件），
> 首次构建请执行 `gradle wrapper` 生成，或直接用已安装的 Gradle 8.x。

### 可选：复用 Web 端的熄灯界面

`BlackoutActivity` 同时提供**原生布局**与**WebView 加载同一套 Web UI**两种渲染路径。
若要启用 WebView 路径，先把 Web 端构建产物同步到 assets：

```bash
node scripts/build.mjs
# 然后把 dist/ 复制到 platforms/android/app/src/main/assets/web/
```

这样能保证黑屏界面在三端**像素级一致**，同时由原生层负责真正的系统接管。
若不执行这一步，应用会走原生布局，功能完整。

---

## 能力对照（PRD）

### 睡眠计划管理（PRD 2.1）

| 需求 | 实现 |
| --- | --- |
| 工作日 / 周末两套独立时段，支持跨天 | `core/Schedule.kt`，与 Web 端同语义 |
| 一键开启 / 关闭计划 | `data/SharedPrefsStore.kt` + 设置界面 |
| 提前预告提醒（10/15/30 分钟） | `ui/WarningActivity.kt` + `lock/AlarmScheduler.kt` |
| 每周 2 次解除额度，周一 0 点重置 | `core/QuotaStore.kt` |

### 强制熄灯模式（PRD 2.2）

| 需求 | 实现 |
| --- | --- |
| 到点自动触发 | `lock/AlarmScheduler.kt` + `receiver/AlarmReceiver.kt` |
| 拉灯绳入场动画 | `res/drawable/bg_lamp_*.xml` + 属性动画 |
| 全屏黑屏界面 | `ui/BlackoutActivity.kt` + `res/layout/activity_blackout.xml` |
| 熄灯时段内解锁设备直接进入黑屏 | `showWhenLocked` + `turnScreenOn` + 前台服务 |
| 重启后自动恢复 | `receiver/BootReceiver.kt` |
| 实时时间 / 剩余时长 / 轮播文案 | `ui/BlackoutActivity.kt` + `core/CopyLibrary.kt` |
| 白名单应用与总时长上限 | `core/WhitelistBudget.kt` + `ui/SettingsActivity.kt` |
| 系统电话 / 短信不受限 | `util/CallStateMonitor.kt` + 白名单默认项 |
| 连续点击 5 次触发紧急解除 | `util/TapCounter.kt` |
| 密码 + 额度扣减 | `core/PasswordHasher.kt` + `ui/EmergencyActivity.kt` |

### 助眠音频（PRD 2.3）

| 需求 | 实现 |
| --- | --- |
| 五类白噪音 | `audio/NoiseSynth.kt` —— **用 AudioTrack 实时合成**，不引入任何音频素材，零版权风险 |
| 15/30/60 分钟或持续至熄灯结束 | `service/AudioService.kt` |
| 熄屏后台播放 | 前台服务 `foregroundServiceType="mediaPlayback"` |
| 独立音量调节 | `AudioService.kt` |

### AI 场景化文案（PRD 2.4）

| 需求 | 实现 |
| --- | --- |
| 场景识别（周五晚 / 假期前夜 / 假期最后一晚等） | `core/Scene.kt` |
| OpenAI 兼容接口，Key 仅存本机 | `core/AiClient.kt` + SharedPreferences |
| 未配置 Key 时降级到内置文案库 | `core/CopyLibrary.kt` |

### 防绕过安全防护体系（PRD 三）

| 需求 | 实现 | 说明 |
| --- | --- | --- |
| 前台服务保活 | `service/LockForegroundService.kt` | `specialUse` 类型 + 常驻通知 |
| 禁止强制停止 | `receiver/SleepDeviceAdminReceiver.kt` | 设备管理员 |
| 禁止清理后台 | 前台服务 + 电池优化白名单引导 | `util/Permissions.kt` |
| 防系统时间篡改，**不重置剩余时长** | `lock/ClockGuard.kt` + `receiver/TimeChangeReceiver.kt` | 服务内动态注册同一套，双保险 |
| 重启自动恢复 | `receiver/BootReceiver.kt` | 开机后检测是否处于熄灯时段 |
| 防卸载保护 | `receiver/SleepDeviceAdminReceiver.kt` | 需先在应用内解除权限 |
| 白名单之外的 App 被拦截 | `service/SleepAccessibilityService.kt` | 只读包名，不读取窗口内容 |

---

## 目录结构

```
platforms/android/
├── settings.gradle.kts / build.gradle.kts / gradle.properties
├── gradle/libs.versions.toml          版本目录（AGP 8.6.1 / Kotlin 2.0.21）
└── app/
    ├── build.gradle.kts
    ├── proguard-rules.pro
    └── src/main/
        ├── AndroidManifest.xml        权限、组件、前台服务类型声明
        ├── java/com/xideng/sleep/
        │   ├── XidengApp.kt            Application：依赖装配入口
        │   ├── AppGraph.kt             轻量依赖容器
        │   ├── core/                   平台无关逻辑（JS 版的 Kotlin 移植）
        │   │   ├── Constants.kt  TimeUtils.kt  Holidays.kt  Schedule.kt
        │   │   ├── Scene.kt      CopyLibrary.kt  QuotaStore.kt
        │   │   ├── WhitelistBudget.kt  PasswordHasher.kt  GuardStore.kt
        │   │   ├── SettingsModels.kt   SettingsStore.kt  KeyValueStore.kt
        │   │   ├── AiClient.kt         Engine.kt
        │   ├── data/SharedPrefsStore.kt  持久化
        │   ├── lock/                     熄灯接管与调度
        │   │   ├── LockController.kt  AlarmScheduler.kt  ClockGuard.kt
        │   ├── service/                  前台服务
        │   │   ├── LockForegroundService.kt  AudioService.kt
        │   │   └── SleepAccessibilityService.kt
        │   ├── receiver/                 系统事件
        │   │   ├── BootReceiver.kt  TimeChangeReceiver.kt
        │   │   ├── AlarmReceiver.kt  SleepDeviceAdminReceiver.kt
        │   ├── audio/NoiseSynth.kt       白噪音实时合成
        │   ├── ui/                       界面
        │   │   ├── MainActivity.kt  BlackoutActivity.kt  WarningActivity.kt
        │   │   ├── EmergencyActivity.kt  SettingsActivity.kt  UiKit.kt
        │   ├── util/                     CallStateMonitor.kt  NotificationHelper.kt
        │   │                             Permissions.kt  TapCounter.kt
        └── res/                         布局、图标、双语资源、无障碍与设备管理员配置
```

---

## 权限清单（PRD 5.1）

| 权限 | 用途 | 未授权时 |
| --- | --- | --- |
| `FOREGROUND_SERVICE` / `_SPECIAL_USE` | 熄灯接管调度保活 | 熄灯可靠性下降 |
| `FOREGROUND_SERVICE_MEDIA_PLAYBACK` | 助眠音频后台播放 | 熄屏后音频可能中断 |
| `POST_NOTIFICATIONS` | 常驻通知（Android 13+） | 前台服务不可见 |
| `RECEIVE_BOOT_COMPLETED` | 开机自启与重启恢复 | 重启后需手动打开应用 |
| `SYSTEM_ALERT_WINDOW` | 悬浮窗（后台合法拉起熄灯界面） | 部分机型上无法自动接管 |
| `SCHEDULE_EXACT_ALARM` | 到点精确触发 | 自动降级为非精确闹钟 |
| `USE_FULL_SCREEN_INTENT` | 预告弹窗在锁屏上全屏显示 | 预告可能只在通知栏出现 |
| `WAKE_LOCK` | 熄灯界面常亮 | 界面可能自动息屏 |
| `VIBRATE` | 交互触感反馈 | 无影响 |
| `READ_PHONE_STATE` | 识别来电、放行通话 | 退回 `AudioManager` 判定，功能不受影响 |
| `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` | 避免夜间被系统冻结 | 熄灯可能被延迟 |
| `INTERNET` / `ACCESS_NETWORK_STATE` | AI 文案（可选功能） | 只用内置文案库 |

**刻意没有申请的权限**：

- `QUERY_ALL_PACKAGES` —— 改用 `<queries>` 只声明必要的 intent 匹配，避免申请一个过宽的敏感权限
- 「读取短信内容」「访问通讯录」等 —— 与本产品功能无关，一律不申请

---

## 已知限制

1. **未编译验证** —— 见本文开头的说明。首次构建大概率需要修编译错误。
2. **无障碍服务的合规风险** —— 使用无障碍服务拦截前台应用，在部分应用商店会被判定为不合规。
   本项目面向开源与个人侧载，不做商店分发。
3. **设备管理员不可在应用内静默开启** —— 必须跳转系统设置由用户手动授权，这是 Android 的设计。
4. **厂商 ROM 差异** —— MIUI / EMUI / ColorOS 等对后台进程有额外限制，
   首次使用需引导用户手动把应用加入"自启动白名单"与"电池优化白名单"。
5. **Gradle Wrapper 的 jar 未提交** —— 二进制文件不入库，首次构建需自行生成。
6. **未适配平板与折叠屏** —— 当前布局按手机竖屏设计。
