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

    /** 演示模式的截止时刻（毫秒）。0 表示未开启。仅存在于内存，进程重启即失效。 */
    @Volatile
    private var demoUntilMs: Long = 0L

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
        val settings = snapshot.settings

        // ── 1. 防系统时间篡改检测（PRD 三）──
        if (settings.guard.detectClockTamper) {
            val jump = graph.clockGuard.sample()
            if (jump != null) {
                graph.guardStore.recordTamper(jump.direction, jump.driftMs)
            }
        }

        // ── 2. 落锚 / 跨时段重新落锚（演示模式不落锚，否则演示结束后会被锚点锁住）──
        if (!demoOverride) maintainAnchor(snapshot)

        // ── 3. 白名单时长实时扣减（PRD 2.2.3）──
        val exhausted = chargeWhitelistSession()

        // ── 4. 应用相位：进入或退出熄灯 ──
        applyPhase(snapshot, exhausted)

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
        // 兜底门禁：用户从未主动启用过计划时，绝不熄灯。
        //
        // 只在 MainActivity 里拦是不够的 —— 闹钟、开机自启、前台服务心跳都会
        // 直接走到这里，绕过 MainActivity。默认 plan.enabled = false 已经挡住了
        // 大部分情况，这一层是防止数据被改回、或从旧版本升级上来的存量配置。
        if (!snapshot.settings.onboarded) {
            BlackoutActivity.requestDismiss()
            WarningActivity.requestDismiss()
            return
        }

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
                    BlackoutActivity.launch(context)
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

    /** 闹钟到点（PRD 2.2.1） */
    fun onAlarm() {
        startLockService()
        tick("alarm", force = true)
    }

    /** 紧急解除成功后调用（PRD 2.2.5） */
    fun onEmergencyDismissed() {
        endWhitelistSession()
        BlackoutActivity.requestDismiss()
        WarningActivity.requestDismiss()
        NotificationHelper.cancel(context, Constants.NOTIFICATION_ID_WARNING)
    }

    /** 无障碍服务检测到非白名单应用时调用（PRD 三） */
    fun reassertBlackout() {
        if (!BlackoutActivity.isVisible()) {
            BlackoutActivity.launch(context)
        }
    }

    /* ───────────── 演示模式 ───────────── */

    /** 当前是否处于演示模式（让人不必等到 23:00 就能看到熄灯界面） */
    fun isDemoActive(): Boolean = isDemo()

    private fun isDemo(): Boolean =
        demoUntilMs > 0L && System.currentTimeMillis() < demoUntilMs

    fun startDemo(durationMs: Long) {
        demoUntilMs = System.currentTimeMillis() + durationMs
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
    }
}
