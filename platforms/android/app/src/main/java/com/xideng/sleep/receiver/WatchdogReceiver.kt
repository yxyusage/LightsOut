package com.xideng.sleep.receiver

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.xideng.sleep.XidengApp

/**
 * 熄灯早睡 · 看门狗（每 15 分钟一次）
 *
 * 存在的理由：厂商 ROM 会在用户不知情的情况下清理后台。前台服务被停掉之后，
 * 即使声明了 START_STICKY，HONOR / 华为 / 小米等 ROM 也经常不把它拉回来。
 * 结果是"熄灯计划还在，但到点什么都不发生"——用户完全无从察觉。
 *
 * 这个接收器是最后一道保险。它做四件事：
 *  1. 把前台服务拉回来（如果已经死了）；
 *  2. 重排主闹钟（防止某次调度失败后永久失效）；
 *  3. 检查无障碍服务是否被系统关掉，关掉了就发通知提醒；
 *  4. 无障碍不可用时，用 UsageStatsManager 做前台应用检测兜底。
 *
 * 刻意做得非常轻：不读网络、不写数据库、不做 UI，只做"把该活的拉活"。
 */
class WatchdogReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent?) {
        try {
            val pending = goAsync()
            try {
                XidengApp.graphOf(context).controller.onWatchdog()
            } finally {
                pending.finish()
            }
        } catch (error: Exception) {
            // 看门狗自身绝不能抛异常：它已经是最后一道保险了
        }
    }
}
