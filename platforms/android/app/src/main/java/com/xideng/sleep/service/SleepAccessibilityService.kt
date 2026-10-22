package com.xideng.sleep.service

import android.accessibilityservice.AccessibilityService
import android.content.Intent
import android.os.SystemClock
import android.view.accessibility.AccessibilityEvent
import com.xideng.sleep.XidengApp
import com.xideng.sleep.core.Phase
import com.xideng.sleep.ui.BlackoutActivity
import com.xideng.sleep.util.NotificationHelper

/**
 * 熄灯早睡 · 应用监听（PRD 三「防绕过安全防护体系」）
 *
 * 熄灯时段内，只要前台应用既不是本应用、也不是白名单/系统放行应用，
 * 就立刻把用户送回熄灯界面。
 *
 * ## 边界必须诚实说明
 *
 * 无障碍服务能"看到"前台包名，但**无法阻止应用启动**，也无法杀掉别的应用。
 * 它实现的是"你逃不掉熄灯状态"，不是"你打不开微信"。
 * 这个边界写在 README 与引导页里，不做夸大宣传。
 *
 * ## 关于"过一段时间自动关闭"
 *
 * 这不是本应用的缺陷，而是 Android 与厂商 ROM 的既定行为：无障碍属于高权限服务，
 * 系统为了省电与安全会定期回收，HONOR / 华为 / 小米等 ROM 尤其激进。
 *
 * **应用无权自己把无障碍服务重新打开**——那是一条系统安全红线，
 * 任何应用都不该能绕过。所以这里能做的是三件事：
 *  1. [onUnbind] 时立刻发通知，让用户知道防护掉了一环；
 *  2. 前台服务里的看门狗每 15 分钟复查一次，仍关闭就再次提醒；
 *  3. 用 UsageStatsManager 做一条不需要无障碍的降级通道。
 *
 * 也就是说：**它可能被关，但不会再静默失效。**
 */
class SleepAccessibilityService : AccessibilityService() {

    @Volatile private var lastReassertAt: Long = 0L

    override fun onServiceConnected() {
        super.onServiceConnected()
        // 服务恢复：撤掉之前那条"防护掉了一环"的提醒
        try {
            NotificationHelper.cancel(
                this,
                com.xideng.sleep.core.Constants.NOTIFICATION_ID_DEGRADED,
            )
        } catch (error: Exception) {
            // 忽略
        }
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event == null) return
        if (event.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return

        val packageName = event.packageName?.toString() ?: return
        if (packageName.isEmpty()) return
        if (packageName == applicationContext.packageName) return

        val graph = XidengApp.graphOf(this)
        val snapshot = graph.engine.snapshot()
        if (snapshot.phase != Phase.ACTIVE) return
        // 白名单判定与看门狗共用同一份，避免两条通道对"什么算放行"给出不同答案
        if (graph.controller.isAllowedPackage(packageName, snapshot)) return

        reassertBlackout()
    }

    override fun onInterrupt() {
        // 无障碍服务被系统中断（例如用户临时关闭服务）。
        // 熄灯状态本身由前台服务维持，判定逻辑不受影响，这里不额外处理。
    }

    /**
     * 服务被系统关闭 / 被用户在设置里关掉时调用。
     *
     * 这是**唯一一次**能在"服务刚死掉"的瞬间通知用户的机会：
     * 之后就只能靠看门狗每 15 分钟来复查了。
     */
    override fun onUnbind(intent: Intent?): Boolean {
        try {
            NotificationHelper.postDegradedProtection(
                this,
                "无障碍服务已被系统关闭，「切走再回来会被拉回」这一层暂时失效。点这里恢复。",
            )
        } catch (error: Exception) {
            // 忽略
        }
        return super.onUnbind(intent)
    }

    /**
     * 把熄灯界面拉回最前。
     *
     * 三级降级，任何一级失败都要继续试下一级：
     *  1. 直接 startActivity（有后台启动豁免时可用）；
     *  2. 退回主屏 —— 至少把用户从违规应用里拽出来；
     *  3. 兜底把主闹钟与看门狗重排一遍，保证下一次还有机会触发。
     */
    private fun reassertBlackout() {
        val now = SystemClock.elapsedRealtime()
        if (now - lastReassertAt < REASSERT_DEBOUNCE_MS) return
        lastReassertAt = now

        if (BlackoutActivity.isVisible()) return

        try {
            startActivity(
                Intent(this, BlackoutActivity::class.java)
                    .setAction(BlackoutActivity.ACTION_ENTER)
                    .addFlags(
                        Intent.FLAG_ACTIVITY_NEW_TASK or
                            Intent.FLAG_ACTIVITY_SINGLE_TOP or
                            Intent.FLAG_ACTIVITY_REORDER_TO_FRONT,
                    ),
            )
            return
        } catch (error: Exception) {
            // Android 10+ 的后台启动限制拒绝：继续降级
        }

        // 降级 ②：把用户从那个应用里拽出来
        try {
            performGlobalAction(GLOBAL_ACTION_HOME)
        } catch (error: Exception) {
            // 忽略
        }

        // 降级 ③：把唤醒链路续上，至少下一次还能触发
        try {
            XidengApp.graphOf(this).controller.armSchedules()
        } catch (error: Exception) {
            // 忽略
        }
    }

    companion object {
        private const val REASSERT_DEBOUNCE_MS = 800L
    }
}
