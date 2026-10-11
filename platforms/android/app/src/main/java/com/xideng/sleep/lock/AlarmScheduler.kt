package com.xideng.sleep.lock

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import com.xideng.sleep.core.Schedule
import com.xideng.sleep.core.TimeUtils
import com.xideng.sleep.receiver.AlarmReceiver

/**
 * 熄灯早睡 · 到点精确触发（PRD 2.2.1）
 *
 * 前台服务在运行时会自己按秒判定相位，闹钟只负责"服务被系统杀掉之后还能被叫醒"。
 * 因此这里的策略是：能用精确闹钟就用精确闹钟，没有授权就退回非精确——
 * **绝不因为少一个权限就让熄灯计划失效**。
 */
object AlarmScheduler {

    const val ACTION_TICK = "com.xideng.sleep.action.ALARM_TICK"
    private const val REQUEST_CODE = 2001

    fun schedule(context: Context, plan: com.xideng.sleep.core.PlanSettings?, nowMs: Long = System.currentTimeMillis()) {
        val manager = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return

        if (plan == null || !plan.enabled) {
            cancel(context)
            return
        }

        val nextMs = Schedule.nextBoundaryAt(plan, java.time.Instant.ofEpochMilli(nowMs))
        if (nextMs == null) {
            cancel(context)
            return
        }

        val triggerAt = maxOf(nextMs, nowMs + 1_000L)
        val pending = pendingIntent(context)

        try {
            val canExact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || manager.canScheduleExactAlarms()
            if (canExact) {
                manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pending)
            } else {
                // 没拿到「闹钟与提醒」授权时退回非精确闹钟：可能晚几分钟，但不会不响
                manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pending)
            }
        } catch (error: SecurityException) {
            try {
                manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pending)
            } catch (ignored: Exception) {
                // 忽略：调度失败不影响前台服务的按秒判定
            }
        }
    }

    fun cancel(context: Context) {
        val manager = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
        try {
            manager.cancel(pendingIntent(context))
        } catch (error: Exception) {
            // 忽略
        }
    }

    private fun pendingIntent(context: Context): PendingIntent {
        val intent = Intent(context, AlarmReceiver::class.java).setAction(ACTION_TICK)
        return PendingIntent.getBroadcast(
            context,
            REQUEST_CODE,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    /** 供通知文案使用：下一次熄灯开始时间的人类可读描述 */
    fun describeNext(plan: com.xideng.sleep.core.PlanSettings?, nowMs: Long = System.currentTimeMillis()): String {
        if (plan == null || !plan.enabled) return "熄灯计划已关闭"
        val window = Schedule.nextWindowAt(plan, java.time.Instant.ofEpochMilli(nowMs)) ?: return "暂无后续时段"
        val local = TimeUtils.localDateTime(window.start)
        return "下一次熄灯：" + TimeUtils.dateKey(local.toLocalDate()) + " " + TimeUtils.formatClock(local)
    }
}
