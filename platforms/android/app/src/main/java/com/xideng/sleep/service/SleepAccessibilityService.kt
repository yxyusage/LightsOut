package com.xideng.sleep.service

import android.accessibilityservice.AccessibilityService
import android.content.Intent
import android.os.SystemClock
import android.view.accessibility.AccessibilityEvent
import com.xideng.sleep.XidengApp
import com.xideng.sleep.core.Phase
import com.xideng.sleep.core.Settings
import com.xideng.sleep.ui.BlackoutActivity

/**
 * 熄灯早睡 · 应用监听（PRD 三「防绕过安全防护体系」）
 *
 * 熄灯时段内，只要前台应用既不是本应用、也不是白名单/系统放行应用，
 * 就立刻把用户送回熄灯界面；拉不起来时至少按一次 Home，把他从那个应用里拽出来。
 *
 * 边界必须诚实说明：无障碍服务能"看到"前台包名，但**无法阻止应用启动**，
 * 也无法杀掉别的应用。它实现的是"你逃不掉熄灯状态"，不是"你打不开微信"。
 * 这个边界写在 README 与引导页里，不做夸大宣传。
 */
class SleepAccessibilityService : AccessibilityService() {

    @Volatile private var lastReassertAt: Long = 0L

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event == null) return
        if (event.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return

        val packageName = event.packageName?.toString() ?: return
        if (packageName.isEmpty()) return
        if (packageName == applicationContext.packageName) return

        val graph = XidengApp.graphOf(this)
        val snapshot = graph.engine.snapshot()
        if (snapshot.phase != Phase.ACTIVE) return
        if (isAllowed(packageName, snapshot.settings)) return

        reassertBlackout()
    }

    override fun onInterrupt() {
        // 无障碍服务被系统中断（例如用户临时关闭服务）。无需特殊处理：
        // 熄灯状态本身由前台服务维持，不受影响。
    }

    /**
     * 白名单应用 + 系统放行包名。
     *
     * 系统放行部分对应 PRD 2.2.4「系统来电、短信、闹钟默认不受熄灯模式限制」：
     * 除了电话/短信本身，还要放行 SystemUI（来电界面、状态栏）、权限控制器与电话服务，
     * 否则接电话会被自己的熄灯界面盖住。
     */
    private fun isAllowed(packageName: String, settings: Settings): Boolean {
        for (app in settings.whitelist.apps) {
            if (app.packageName.isNotEmpty() && app.packageName == packageName) return true
        }
        return SYSTEM_ALLOWED.any { it == packageName }
    }

    private fun reassertBlackout() {
        val now = SystemClock.elapsedRealtime()
        if (now - lastReassertAt < REASSERT_DEBOUNCE_MS) return
        lastReassertAt = now

        if (BlackoutActivity.isVisible()) return

        val started = try {
            startActivity(
                Intent(this, BlackoutActivity::class.java)
                    .setAction(BlackoutActivity.ACTION_ENTER)
                    .addFlags(
                        Intent.FLAG_ACTIVITY_NEW_TASK or
                            Intent.FLAG_ACTIVITY_SINGLE_TOP or
                            Intent.FLAG_ACTIVITY_REORDER_TO_FRONT,
                    ),
            )
            true
        } catch (error: Exception) {
            // Android 10+ 的后台启动限制可能拒绝；此时退回按 Home
            false
        }

        if (!started) {
            performGlobalAction(GLOBAL_ACTION_HOME)
        }
    }

    companion object {
        private const val REASSERT_DEBOUNCE_MS = 800L

        /**
         * 熄灯期间必须放行的系统包名。
         * 刻意不包含桌面（Launcher）：PRD 2.2.1 要求"解锁设备后直接进入熄灯黑屏界面，
         * 不会跳转至系统桌面"，因此按 Home 也会被立刻重新接管。
         */
        private val SYSTEM_ALLOWED = listOf(
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
