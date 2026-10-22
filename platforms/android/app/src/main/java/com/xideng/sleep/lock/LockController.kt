package com.xideng.sleep.lock

import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.SystemClock
import com.xideng.sleep.AppGraph
import com.xideng.sleep.core.Constants
import com.xideng.sleep.core.EngineSnapshot
import com.xideng.sleep.core.Phase
import com.xideng.sleep.core.TimeUtils
import com.xideng.sleep.service.LockForegroundService
import com.xideng.sleep.ui.BlackoutActivity
import com.xideng.sleep.ui.WarningActivity
import com.xideng.sleep.util.CallStateMonitor
import com.xideng.sleep.util.NotificationHelper
import com.xideng.sleep.util.Permissions
import java.time.Instant

/**
 * 熄灯早睡 · 熄灯接管控制器
 *
 * 这是"何时进入熄灯、何时退出熄灯"的唯一决策点。所有入口
 * （前台服务心跳、开机广播、时间变更广播、闹钟、用户点开应用）都只调用 [tick]，
 * 保证任何一条路径都不会绕过同一套判定。
 *
 * 它同时负责 PRD 三的防篡改：进入熄灯时在 [com.xideng.sleep.core.GuardStore] 落锚，
 * 之后即使用户修改系统时间，剩余时长也不会被重置。
 */
class LockController(private val context: Context, private val graph: AppGraph) {

    @Volatile
    private var lastTimeChangeHandledAt: Long = 0L

    @Volatile
    private var lastScheduledTriggerAt: Long = 0L

    @Volatile
    private var lastPhase: Phase = Phase.OFF

    /**
     * 上一次已提醒过的防护降级状态（用于去重）。
     *
     * 看门狗每 15 分钟复查一次，同一个降级原因只该提醒一次，
     * 否则就变成每 15 分钟一条的骚扰通知。
     */
    private var lastDegradedSignature: String? = null

    /** 演示模式的截止时刻（毫秒）。0 表示未开启。仅存在于内存，进程重启即失效。 */
    @Volatile
    private var demoUntilMs: Long = 0L

    /** 已经要求过拉绳的时段键。每个熄灯时段只要求一次（与桌面端 / Web 端一致）。 */
    private var lastPullWindowKey: String? = null

    /**
     * 判定并执行一次相位。
     *
     * @param origin 调用来源，仅用于排查问题（不会写入任何日志或网络请求）
     * @param force  为 true 时强制重排闹钟并重新评估，忽略节流
     */
    fun tick(origin: String, force: Boolean = false): EngineSnapshot {
        val base = graph.engine.snapshot()
        val demoOverride = isDemo() && base.phase != Phase.ACTIVE
        val snapshot = if (demoOverride) {
            val remaining = maxOf(0L, demoUntilMs - System.currentTimeMillis())
            base.copy(
                phase = Phase.ACTIVE,
                remainingMs = remaining,
                windowStartKey = base.windowStartKey ?: DEMO_WINDOW_KEY,
                windowEnd = base.windowEnd ?: Instant.now().plusMillis(remaining),
                anchored = false,
            )
        } else {
            base
        }
        // ── 0. 兜底门禁：从未主动启用过计划时，相位一律按"未熄灯"处理 ──
        //
        // ⚠️ 这一步必须在**相位判定的出口**做，而不是在 applyPhase 里"补一次 dismiss"。
        // 早先写成了后者，结果和无障碍服务的 reassertBlackout 直接对打：
        //   applyPhase 每 250ms dismiss 一次，无障碍每 800ms launch 一次 ——
        // 真机表现就是"画面一直在来回切"。
        // 把相位压成 OFF 之后，下面所有分支（含 reassert）都不会再认为应该熄灯，
        // 矛盾从源头消失。
        //
        // 演示模式不受此门禁限制：那是用户显式点的一次预览，
        // 否则刚装好、还没启用计划的人点"立即预览"会什么都看不到。
        // ⚠️ 门禁条件必须同时看 plan.enabled。
        //
        // 早先只判断 onboarded，而 onboarded 只有在**用户手动拨动计划开关**时才会置 true
        // （见 SettingsActivity）。如果用户靠旧版本的默认值就已经 plan.enabled = true，
        // 却从未拨过那个开关，就会出现一个极其难查的组合：
        //   **计划显示"已启用"，但到点什么都不会发生，打开 App 也救不回来**（同一个门禁）。
        //
        // 正确的语义是：用户**显式启用过计划**（plan.enabled）就应该尊重它；
        // onboarded 只是"是否走完引导"的 UI 概念，不该用来否决一个已启用的计划。
        // 新安装时 plan.enabled 默认为 false，因此这个条件仍然挡住了"刚装好就乱锁"的情况。
        val planIsOn = snapshot.settings.plan.enabled
        val gated =
            if (!snapshot.settings.onboarded && !planIsOn && !demoOverride) {
                snapshot.copy(phase = Phase.OFF, remainingMs = 0)
            } else {
                snapshot
            }
        val settings = gated.settings

        // ── 1. 防系统时间篡改检测（PRD 三）──
        if (settings.guard.detectClockTamper) {
            val jump = graph.clockGuard.sample()
            if (jump != null) {
                graph.guardStore.recordTamper(jump.direction, jump.driftMs)
            }
        }

        // ── 2. 落锚 / 跨时段重新落锚（演示模式不落锚，否则演示结束后会被锚点锁住）──
        if (!demoOverride) maintainAnchor(gated)

        // ── 3. 白名单时长实时扣减（PRD 2.2.3）──
        val exhausted = chargeWhitelistSession()

        // ── 4. 应用相位：进入或退出熄灯 ──
        applyPhase(gated, exhausted)

        // ── 5. 重排下一次唤醒（PRD 2.2.1）──
        if (force || snapshot.phase != lastPhase) {
            AlarmScheduler.schedule(context, settings.plan)
            lastScheduledTriggerAt = 0L
        }

        lastPhase = snapshot.phase
        return snapshot
    }

    /**
     * 锚点维护。
     *
     * 锚点记录"进入熄灯那一刻还剩多久"，之后剩余时长由单调时钟推算，
     * 因此用户把系统时间往前拨或往后拨都无法重置它（PRD 三「不重置剩余时长」）。
     */
    private fun maintainAnchor(snapshot: EngineSnapshot) {
        if (snapshot.phase == Phase.ACTIVE) {
            val startKey = snapshot.windowStartKey ?: return
            val anchor = graph.guardStore.getAnchor()
            val elapsedNow = SystemClock.elapsedRealtime()

            if (anchor == null || anchor.startKey != startKey) {
                graph.guardStore.armAnchor(snapshot.remainingMs, startKey)
                return
            }
            if (anchor.elapsedMs > elapsedNow) {
                // 设备重启过：elapsedRealtime 归零。把锚点重新标定到当前时刻，但**保留剩余时长**。
                val remaining = graph.guardStore.anchorRemainingMs()
                if (remaining != null) {
                    graph.guardStore.rebaseAnchor(remaining, startKey)
                } else {
                    graph.guardStore.clearAnchor()
                }
            }
            return
        }

        // 不在熄灯中：锚点已经耗尽就清掉，别让它在下一个时段里误伤
        if (graph.guardStore.anchorRemainingMs() == null) {
            graph.guardStore.clearAnchor()
        }
    }

    /**
     * 白名单使用时长结算。
     * @return true 表示额度刚刚耗尽，需要立刻把人从应用里拽回来（PRD 2.2.3）
     */
    private fun chargeWhitelistSession(): Boolean {
        val session = graph.whitelistSession
        if (!session.active) return false
        if (!session.countsAgainstQuota) return false

        val now = System.currentTimeMillis()
        val delta = now - session.lastChargedAt
        if (delta < Constants.WHITELIST_TICK_MS) return false

        session.lastChargedAt = now
        val result = graph.budget.charge(delta, Instant.ofEpochMilli(now))
        if (result.exhausted) {
            session.clear()
            return true
        }
        return false
    }

    /** 用户在熄灯界面点开白名单应用时调用，开始计时 */
    fun beginWhitelistSession(appId: String, appName: String, countsAgainstQuota: Boolean) {
        graph.whitelistSession.begin(appId, appName, countsAgainstQuota)
    }

    /** 用户回到熄灯界面 / 熄灯结束时调用，结算最后一段时长 */
    fun endWhitelistSession() {
        val session = graph.whitelistSession
        if (!session.active) return
        if (session.countsAgainstQuota) {
            val now = System.currentTimeMillis()
            val delta = now - session.lastChargedAt
            if (delta > 0L) graph.budget.charge(delta, Instant.ofEpochMilli(now))
        }
        session.clear()
    }

    /** 把相位落到界面上 */
    private fun applyPhase(snapshot: EngineSnapshot, whitelistExhausted: Boolean) {
        // 门禁已上移到 tick() 里（把相位压成 OFF）。
        // 不要在这里"每拍 dismiss" —— 那会和 reassertBlackout 打架造成画面反复切换。

        // PRD 2.2.4：通话中放行。收起熄灯界面但服务继续运行，通话结束后的下一拍自动恢复。
        if (CallStateMonitor.isInCall(context)) {
            BlackoutActivity.requestDismiss()
            WarningActivity.requestDismiss()
            NotificationHelper.cancel(context, Constants.NOTIFICATION_ID_WARNING)
            return
        }

        when (snapshot.phase) {
            Phase.ACTIVE -> {
                WarningActivity.requestDismiss()
                NotificationHelper.cancel(context, Constants.NOTIFICATION_ID_WARNING)

                // 用户正在使用白名单应用、且额度没用完时不去打断他
                if (graph.whitelistSession.active && !whitelistExhausted) return

                // 用 isPresented 而不是 isVisible：息屏时 Activity 只是 paused，
                // 界面还在返回栈上，不该再 launch 一次（否则画面来回切、屏幕被反复点亮）
                if (!BlackoutActivity.isPresented()) {
                    // 新时段开始时要求用户亲手拉一次灯绳；同一时段内被重新拉回则不重复要求。
                    // 演示模式的 key 固定，所以 startDemo() 会把它清掉，让每次预览都能看到拉绳。
                    val windowKey = snapshot.windowStartKey
                    val newWindow = windowKey != null && windowKey != lastPullWindowKey
                    if (newWindow) {
                        lastPullWindowKey = windowKey
                        // 新时段：允许再播一次入场动画（进程级标志，跨 Activity 重建保持）
                        BlackoutActivity.resetEnterFlag()
                    }
                    BlackoutActivity.launch(context, requirePull = newWindow)
                }
            }

            Phase.WARNING -> {
                NotificationHelper.post(
                    context,
                    Constants.NOTIFICATION_ID_WARNING,
                    NotificationHelper.buildWarningNotification(context, describeWarning(snapshot)),
                )
                if (!BlackoutActivity.isVisible() && !WarningActivity.isVisible()) {
                    WarningActivity.launch(context)
                }
            }

            Phase.IDLE, Phase.OFF -> {
                BlackoutActivity.requestDismiss()
                WarningActivity.requestDismiss()
                NotificationHelper.cancel(context, Constants.NOTIFICATION_ID_WARNING)
            }
        }
    }

    /* ───────────── 生命周期入口 ───────────── */

    /** 开机 / 应用被替换后调用（PRD 2.2.1、三：重启后自动恢复） */
    fun onBoot() {
        graph.clockGuard.reset()
        startLockService()
        tick("boot", force = true)
    }

    /**
     * 系统时间 / 时区变更（PRD 三）。
     *
     * 清单里声明的接收器在 Android 8+ 不一定能收到 TIME_SET，
     * 因此前台服务还会动态注册同一套；这里做一次去重，避免记两条违规。
     */
    fun onTimeChanged(action: String) {
        val now = SystemClock.elapsedRealtime()
        if (now - lastTimeChangeHandledAt < 1_500L) return
        lastTimeChangeHandledAt = now

        val settings = graph.settingsStore.value
        if (settings.guard.detectClockTamper) {
            when (action) {
                Intent.ACTION_TIME_CHANGED -> {
                    val jump = graph.clockGuard.sample()
                    graph.guardStore.recordTamper(jump?.direction ?: "time-set", jump?.driftMs ?: 0L)
                }
                Intent.ACTION_TIMEZONE_CHANGED -> {
                    graph.guardStore.recordTamper("timezone", 0L)
                }
                // DATE_CHANGED 是每天午夜都会来的正常事件，不算违规
                else -> Unit
            }
            graph.clockGuard.reset()
        }

        startLockService()
        tick("time-changed", force = true)
    }

    /**
     * 只重排闹钟与看门狗，不做相位判定。
     *
     * 供前台服务在 onCreate / onDestroy 时调用：服务刚被拉活或即将消失时，
     * 需要确保"下一次唤醒"这条线索没断——这正是"清理后台后到点不熄灯"的关键一环。
     */
    fun armSchedules() {
        AlarmScheduler.schedule(context, graph.settingsStore.value.plan)
        AlarmScheduler.scheduleWatchdog(context)
    }

    /** 闹钟到点（PRD 2.2.1） */
    fun onAlarm() {
        startLockService()
        tick("alarm", force = true)
    }

    /**
     * 看门狗（每 15 分钟一次，见 [com.xideng.sleep.receiver.WatchdogReceiver]）。
     *
     * 厂商 ROM 清理后台是不打招呼的：服务没了、闹钟没重排、无障碍被关，
     * 用户只会看到"计划还在，但到点什么都不发生"。这一步负责把所有环节拉回正轨。
     */
    fun onWatchdog() {
        // ① 服务被清理过就拉回来
        startLockService()

        // ② 主闹钟重排一遍：某次调度失败后不会永久失效
        AlarmScheduler.schedule(context, graph.settingsStore.value.plan)

        // ③ 看门狗自己要续命 —— 否则它自己也会消失
        AlarmScheduler.scheduleWatchdog(context)

        // ④ 先按正常路径判定一次
        val snapshot = tick("watchdog", force = true)

        // ⑤ 防护降级检测：无障碍被系统关掉、或电池优化未豁免时，明确告诉用户
        reportDegradedProtection(snapshot)

        // ⑥ 无障碍不可用时的兜底：用 UsageStatsManager 轮询前台应用
        pollForegroundFallback(snapshot)
    }

    /**
     * 防护降级时发一条常驻通知。
     *
     * 这是"无障碍过一段时间自动关闭"唯一能做的事——系统不允许应用自己把无障碍服务重新打开
     * （那是一条安全红线，任何应用都不该能绕过）。我们能做的是**让它不再静默失效**：
     * 用户至少知道"防护掉了一环"，并且能一键回到设置页恢复。
     */
    private fun reportDegradedProtection(snapshot: EngineSnapshot) {
        val accessibilityOk = Permissions.isAccessibilityServiceEnabled(context)
        val batteryOk = Permissions.isIgnoringBatteryOptimizations(context)

        if (accessibilityOk && batteryOk) {
            NotificationHelper.cancel(context, Constants.NOTIFICATION_ID_DEGRADED)
            lastDegradedSignature = null
            return
        }

        // 只在计划开启时提醒；计划本身就关着的时候没必要打扰
        if (!snapshot.settings.plan.enabled) return

        val reasons = buildList {
            if (!accessibilityOk) add("无障碍服务已被系统关闭，「切走再回来会被拉回」这一层失效")
            if (!batteryOk) add("本应用未加入电池优化白名单，夜间容易被系统冻结")
        }
        val signature = reasons.joinToString("；")

        // ⚠️ 只在**降级状态发生变化**时提醒一次。
        //
        // 看门狗每 15 分钟跑一次，如果不做去重，一个没开电池优化（这是绝大多数用户）
        // 的人会被这条通知每 15 分钟骚扰一次 —— 那就从"提醒"变成了"垃圾通知"，
        // 用户第一件事就是关掉通知权限，连带把熄灯本身的常驻通知也关掉。
        if (signature == lastDegradedSignature) return
        lastDegradedSignature = signature

        NotificationHelper.postDegradedProtection(context, signature)
    }

    /**
     * UsageStatsManager 兜底轮询。
     *
     * 无障碍服务被关掉之后，应用就"看不见"前台是哪个应用了。但「查看使用情况」权限
     * 提供了一条不需要无障碍的替代通道：可以查询当前前台包名。
     *
     * 代价是**只能轮询、无法即时响应**，所以它放在看门狗里按 15 分钟粒度执行，
     * 定位是"兜底"而不是"替代"——真正的即时拦截仍然依赖无障碍。
     */
    private fun pollForegroundFallback(snapshot: EngineSnapshot) {
        if (snapshot.phase != Phase.ACTIVE) return
        if (Permissions.isAccessibilityServiceEnabled(context)) return
        if (!Permissions.hasUsageStatsAccess(context)) return

        val foreground = Permissions.currentForegroundPackage(context) ?: return
        if (foreground == context.packageName) return
        if (isAllowedPackage(foreground, snapshot)) return

        reassertBlackout()
    }

    /**
     * 某个包名在当前设置下是否放行（白名单应用 + 系统放行包名）。
     *
     * 与 [com.xideng.sleep.service.SleepAccessibilityService] 共用同一份判定，
     * 避免两条通道对"什么算放行"给出不同答案。
     */
    fun isAllowedPackage(packageName: String, snapshot: EngineSnapshot): Boolean {
        for (app in snapshot.settings.whitelist.apps) {
            if (app.packageName.isNotEmpty() && app.packageName == packageName) return true
        }
        return SYSTEM_ALLOWED.any { it == packageName }
    }

    /** 紧急解除成功后调用（PRD 2.2.5） */
    fun onEmergencyDismissed() {
        endWhitelistSession()
        BlackoutActivity.requestDismiss()
        WarningActivity.requestDismiss()
        NotificationHelper.cancel(context, Constants.NOTIFICATION_ID_WARNING)
    }

    /**
     * 无障碍服务检测到非白名单应用时调用（PRD 三）。
     *
     * 用 isPresented 而不是 isVisible：息屏时 Activity 只是 paused，
     * 界面还在返回栈上，此时再 launch 一次毫无意义，只会让画面闪。
     * 真正需要"把界面拉到最前"的场景是用户切到了别的应用 ——
     * 那种情况下 Activity 会被 stop，isPresented 仍为 true，
     * 所以这里额外做一次 REORDER_TO_FRONT 是必要的，但不能无脑重启。
     */
    fun reassertBlackout() {
        if (BlackoutActivity.isPresented()) {
            BlackoutActivity.bringToFront()
            return
        }
        BlackoutActivity.launch(context)
    }

    /* ───────────── 演示模式 ───────────── */

    /** 当前是否处于演示模式（让人不必等到 23:00 就能看到熄灯界面） */
    fun isDemoActive(): Boolean = isDemo()

    private fun isDemo(): Boolean =
        demoUntilMs > 0L && System.currentTimeMillis() < demoUntilMs

    fun startDemo(durationMs: Long) {
        demoUntilMs = System.currentTimeMillis() + durationMs
        // 演示模式的时段键是固定的，清掉它，让每次预览都能看到拉绳界面
        lastPullWindowKey = null
        // 每次预览都是"新的一次"，允许重播入场动画
        BlackoutActivity.resetEnterFlag()
        startLockService()
        tick("demo-start", force = true)
    }

    fun stopDemo() {
        demoUntilMs = 0L
        tick("demo-stop", force = true)
        BlackoutActivity.requestDismiss()
    }

    /** 启动最高优先级前台服务（PRD 三：前台服务保活） */
    fun startLockService() {
        val intent = Intent(context, LockForegroundService::class.java)
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        } catch (error: Exception) {
            // Android 12+ 在后台启动前台服务可能被拒。
            // 此时退回「AlarmManager + 无障碍服务」双保险，熄灯判定逻辑本身不受影响。
            try {
                context.startService(intent)
            } catch (ignored: Exception) {
                // 彻底无法启动服务时，只能依赖用户下次打开应用时恢复
            }
        }
    }

    /* ───────────── 文案 ───────────── */

    fun describePhase(snapshot: EngineSnapshot): String {
        return when (snapshot.phase) {
            Phase.ACTIVE ->
                if (snapshot.anchored) {
                    "熄灯中（检测到系统时间被修改，已按原剩余时长继续）"
                } else {
                    "熄灯中，距离结束还有 " + TimeUtils.formatDurationCN(snapshot.remainingMs)
                }
            Phase.WARNING -> "还有 " + TimeUtils.formatCountdownCN(snapshot.remainingMs) + " 进入熄灯"
            Phase.IDLE -> "计划生效中，" + AlarmScheduler.describeNext(snapshot.settings.plan)
            Phase.OFF -> "熄灯计划已关闭"
        }
    }

    private fun describeWarning(snapshot: EngineSnapshot): String =
        "还有 " + TimeUtils.formatCountdownCN(snapshot.remainingMs) + " 进入熄灯模式"

    companion object {
        /** 演示模式下使用的伪时段键，绝不会与真实的 YYYY-MM-DD 冲突 */
        private const val DEMO_WINDOW_KEY = "demo"

        /**
         * 熄灯期间必须放行的系统包名。
         *
         * 对应 PRD 2.2.4「系统来电、短信、闹钟默认不受熄灯模式限制」。
         * 除了电话/短信本身，还要放行 SystemUI（来电界面、状态栏）、权限控制器与电话服务，
         * 否则接电话会被自己的熄灯界面盖住。
         *
         * **刻意不包含桌面（Launcher）**：PRD 2.2.1 要求"解锁设备后直接进入熄灯黑屏界面，
         * 不会跳转至系统桌面"，所以按 Home 也会被立刻重新接管。
         */
        val SYSTEM_ALLOWED = listOf(
            "com.android.systemui",
            "com.android.phone",
            "com.android.server.telecom",
            "com.android.dialer",
            "com.google.android.dialer",
            "com.android.incallui",
            "com.android.mms",
            "com.google.android.apps.messaging",
            "com.android.permissioncontroller",
            "com.google.android.permissioncontroller",
        )
    }
}
