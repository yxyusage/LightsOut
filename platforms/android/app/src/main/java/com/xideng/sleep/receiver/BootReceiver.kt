package com.xideng.sleep.receiver

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.xideng.sleep.XidengApp

/**
 * 熄灯早睡 · 开机自启与重启恢复（PRD 2.2.1、三）
 *
 * 收到开机广播后：拉起前台服务 → 重排闹钟 → 立刻判定一次相位。
 * 若此刻仍在熄灯时段内，会**无需用户任何操作**自动重新进入熄灯模式。
 *
 * 刻意不声明 directBootAware：加锁状态下读不到用户凭据加密的 SharedPreferences，
 * 强行在 LOCKED_BOOT_COMPLETED 里读设置只会拿到默认值，反而可能误判。
 */
class BootReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent?) {
        val action = intent?.action ?: return
        val accepted = action == Intent.ACTION_BOOT_COMPLETED ||
            action == Intent.ACTION_MY_PACKAGE_REPLACED ||
            action == "android.intent.action.QUICKBOOT_POWERON"
        if (!accepted) return

        try {
            XidengApp.graphOf(context).controller.onBoot()
        } catch (error: Exception) {
            // 开机阶段任何异常都不应该让进程崩溃
        }
    }
}
