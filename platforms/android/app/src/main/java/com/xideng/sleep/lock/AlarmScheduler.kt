package com.xideng.sleep.lock

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.SystemClock
import com.xideng.sleep.core.Schedule
import com.xideng.sleep.core.TimeUtils
import com.xideng.sleep.receiver.AlarmReceiver
import com.xideng.sleep.receiver.WatchdogReceiver
import com.xideng.sleep.receiver.AlarmReceiver as TickReceiver

/**
 * 熄灯早睡 · 到点精确触发（PRD 2.2.1）
 *
 * ## 为什么用 setAlarmClock 而不是 setExactAndAllowWhileIdle
 *
 * 这是"挂在后台到点却不熄灯"的真凶。
 *
 * [AlarmManager.setExactAndAllowWhileIdle] 只保证**闹钟按时响**，但不附带任何
 * "允许从后台启动 Activity"的豁免。闹钟广播到了，[com.xideng.sleep.lock.LockController]
 * 也确实判定为熄灯中，然后 `BlackoutActivity.launch()` 被 Android 10+ 的后台启动限制
 * **静默拒绝**——没有异常、没有日志，界面就是不出现。用户看到的现象正是
 * "要点进去才开始"。
 *
 * [AlarmManager.setAlarmClock] 是闹钟类应用专用的接口，它有两点关键差异：
 *  1. 附带**临时的后台启动豁免**，熄灯界面能被正常拉起；
 *  2. 完全不受 Doze 与省电策略影响，且不需要用户额外授权就能精确触发。
 *
 * 代价是系统状态栏会显示一个闹钟图标——对一个"到点必须响"的睡眠工具来说，
 * 这个代价是值得的，它也如实告诉用户"这个应用确实定了一个闹钟"。
 *
 * ## 降级链
 *
 * 任何一步失败都不能让熄灯计划失效：
 *   setAlarmClock → setExactAndAllowWhileIdle → setAndAllowWhileIdle（可能晚几分钟，但会响）
 */
object AlarmScheduler {

    const val ACTION_TICK = "com.xideng.sleep.action.ALARM_TICK"
    private const val REQUEST_CODE = 2001

    /** 看门狗：定期把服务拉回来、把闹钟重排一遍。见 scheduleWatchdog()。 */
    private const val WATCHDOG_REQUEST_CODE = 2002

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
        val pending = tickPendingIntent(context)

        // ① 首选：闹钟应用专用接口，附带后台启动豁免
        try {
            manager.setAlarmClock(
                AlarmManager.AlarmClockInfo(triggerAt, showPendingIntent(context)),
                pending,
            )
            scheduleWatchdog(context, triggerAt)
            return
        } catch (error: SecurityException) {
            // Android 12+ 未授予精确闹钟权限时会走到这里，往下降级
        } catch (error: Exception) {
            // 个别 ROM 对 setAlarmClock 有额外限制，同样降级
        }

        // ② 次选：精确但无后台启动豁免（配合全屏通知仍可在锁屏时拉起）
        try {
            val canExact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || manager.canScheduleExactAlarms()
            if (canExact) {
                manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pending)
            } else {
                manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pending)
            }
        } catch (error: Exception) {
            // ③ 兜底：非精确，可能晚几分钟，但不会完全不响
            try {
                manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pending)
            } catch (ignored: Exception) {
                // 忽略：调度失败不影响前台服务的按秒判定
            }
        }

        scheduleWatchdog(context, triggerAt)
    }

    /**
     * 看门狗闹钟。
     *
     * 厂商 ROM（HONOR / 华为 / 小米等）会以"耗电"为由清理后台，前台服务被停掉之后
     * START_STICKY 往往也不生效，熄灯就此失效，用户毫不知情。
     *
     * 这里额外挂一个**每 15 分钟**的看门狗：它做三件事——把服务拉回来、把主闹钟重排一遍、
     * 顺便检查无障碍服务是否被系统关掉。15 分钟是刻意选的：再短会明显增加耗电，
     * 再长则"发现失效"的延迟太久。
     *
     * 用 setAndAllowWhileIdle 而不是精确闹钟：看门狗不需要精确，
     * 而且系统对非精确闹钟的额度限制更宽松，不会挤掉主闹钟的精确额度。
     */
    fun scheduleWatchdog(context: Context, nextTriggerAt: Long = 0L) {
        val manager = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
        val interval = WATCHDOG_INTERVAL_MS
        val pending = PendingIntent.getBroadcast(
            context,
            WATCHDOG_REQUEST_CODE,
            Intent(context, WatchdogReceiver::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val at = System.currentTimeMillis() + interval
        try {
            manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending)
        } catch (error: Exception) {
            try {
                manager.set(AlarmManager.RTC_WAKEUP, at, pending)
            } catch (ignored: Exception) {
                // 忽略
            }
        }
    }

    fun cancel(context: Context) {
        val manager = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
        try {
            manager.cancel(tickPendingIntent(context))
        } catch (error: Exception) {
            // 忽略
        }
        try {
            manager.cancel(
                PendingIntent.getBroadcast(
                    context,
                    WATCHDOG_REQUEST_CODE,
                    Intent(context, WatchdogReceiver::class.java),
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
                ),
            )
        } catch (error: Exception) {
            // 忽略
        }
    }

    private fun tickPendingIntent(context: Context): PendingIntent {
        val intent = Intent(context, AlarmReceiver::class.java).setAction(ACTION_TICK)
        return PendingIntent.getBroadcast(
            context,
            REQUEST_CODE,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    /**
     * setAlarmClock 要求一个"点闹钟图标时打开什么"的 PendingIntent。
     * 指向主界面，让用户能一眼确认这个闹钟是谁定的。
     */
    private fun showPendingIntent(context: Context): PendingIntent {
        val intent = Intent(Intent.ACTION_MAIN)
            .setClassName(context.packageName, "com.xideng.sleep.ui.MainActivity")
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        return PendingIntent.getActivity(
            context,
            0,
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

    /** 看门狗间隔：15 分钟 */
    const val WATCHDOG_INTERVAL_MS = 15L * 60L * 1000L
}
