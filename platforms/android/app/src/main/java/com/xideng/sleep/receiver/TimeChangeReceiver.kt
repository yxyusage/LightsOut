package com.xideng.sleep.receiver

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.xideng.sleep.XidengApp

/**
 * 熄灯早睡 · 防系统时间篡改（PRD 三）
 *
 * 监听 TIME_SET / TIMEZONE_CHANGED / DATE_CHANGED。
 * 注意：Android 8+ 的隐式广播限制下，TIME_SET 不一定能送到清单接收器，
 * 因此 [com.xideng.sleep.service.LockForegroundService] 还会动态注册同一套；
 * [com.xideng.sleep.lock.LockController.onTimeChanged] 内部做了去重，不会重复记账。
 */
class TimeChangeReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent?) {
        val action = intent?.action ?: return
        val accepted = action == Intent.ACTION_TIME_CHANGED ||
            action == Intent.ACTION_TIMEZONE_CHANGED ||
            action == Intent.ACTION_DATE_CHANGED
        if (!accepted) return

        try {
            XidengApp.graphOf(context).controller.onTimeChanged(action)
        } catch (error: Exception) {
            // 忽略：广播里崩溃会连累 system_server 的派发
        }
    }
}
