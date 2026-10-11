package com.xideng.sleep.service

import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import com.xideng.sleep.XidengApp
import com.xideng.sleep.core.Constants
import com.xideng.sleep.core.EngineSnapshot
import com.xideng.sleep.core.Phase
import com.xideng.sleep.core.TimeUtils
import com.xideng.sleep.lock.AlarmScheduler
import com.xideng.sleep.util.NotificationHelper

/**
 * 熄灯早睡 · 最高优先级前台服务（PRD 三「前台服务保活」）
 *
 * 职责：
 *  1. 常驻通知栏，降低被系统后台清理的概率；
 *  2. 自适应心跳——熄灯中是每秒一拍，其余时间每 15 秒一拍（PRD 六：极低功耗）；
 *  3. 动态注册时间变更广播（Android 8+ 的隐式广播限制下，清单接收器收不到 TIME_SET）；
 *  4. 返回 START_STICKY，被杀后由系统自动重建。
 *
 * 它自身不做任何判定，全部委托给 [com.xideng.sleep.lock.LockController]。
 */
class LockForegroundService : Service() {

    private val handler = Handler(Looper.getMainLooper())
    private val graph by lazy { XidengApp.graphOf(this) }

    @Volatile private var running = false
    private var lastNotificationText: String? = null

    private var timeChangeReceiver: BroadcastReceiver? = null

    private val ticker = object : Runnable {
        override fun run() {
            if (!running) return
            val delay = doTick()
            handler.postDelayed(this, delay)
        }
    }

    override fun onCreate() {
        super.onCreate()
        running = true
        NotificationHelper.ensureChannels(this)
        startForeground(
            Constants.NOTIFICATION_ID_LOCK,
            NotificationHelper.buildLockNotification(this, "熄灯计划运行中", false),
        )
        lastNotificationText = "熄灯计划运行中"
        registerTimeChangeReceiver()
        handler.post(ticker)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // 无论被谁拉起（开机、闹钟、时间变更、用户打开应用），都重新排一次闹钟并即时判定
        graph.controller.tick("service-start", force = true)
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        running = false
        handler.removeCallbacks(ticker)
        unregisterTimeChangeReceiver()
        super.onDestroy()
    }

    /** @return 下一次心跳的间隔（毫秒） */
    private fun doTick(): Long {
        val snapshot = graph.controller.tick("service-tick")
        updateNotification(snapshot)
        return when (snapshot.phase) {
            Phase.ACTIVE, Phase.WARNING -> 1_000L
            else -> 15_000L
        }
    }

    private fun updateNotification(snapshot: EngineSnapshot) {
        val text = notificationText(snapshot)
        if (text == lastNotificationText) return
        lastNotificationText = text
        NotificationHelper.post(
            this,
            Constants.NOTIFICATION_ID_LOCK,
            NotificationHelper.buildLockNotification(this, text, snapshot.phase == Phase.ACTIVE),
        )
    }

    /** 通知文案只取分钟粒度，避免每秒都刷新通知（功耗 + 打扰） */
    private fun notificationText(snapshot: EngineSnapshot): String {
        return when (snapshot.phase) {
            Phase.ACTIVE -> {
                val minutes = (snapshot.remainingMs + 59_000L) / 60_000L
                if (snapshot.anchored) {
                    "熄灯中 · 剩余约 " + minutes + " 分钟（已拦截时间修改）"
                } else {
                    "熄灯中 · 剩余约 " + minutes + " 分钟"
                }
            }
            Phase.WARNING -> {
                val minutes = (snapshot.remainingMs + 59_000L) / 60_000L
                "即将进入熄灯模式 · 还有约 " + minutes + " 分钟"
            }
            Phase.IDLE -> AlarmScheduler.describeNext(snapshot.settings.plan)
            Phase.OFF -> "熄灯计划已关闭"
        }
    }

    private fun registerTimeChangeReceiver() {
        if (timeChangeReceiver != null) return
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context?, intent: Intent?) {
                graph.controller.onTimeChanged(intent?.action ?: return)
            }
        }
        val filter = IntentFilter().apply {
            addAction(Intent.ACTION_TIME_CHANGED)
            addAction(Intent.ACTION_TIMEZONE_CHANGED)
            addAction(Intent.ACTION_DATE_CHANGED)
        }
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
            } else {
                registerReceiver(receiver, filter)
            }
            timeChangeReceiver = receiver
        } catch (error: Exception) {
            timeChangeReceiver = null
        }
    }

    private fun unregisterTimeChangeReceiver() {
        val receiver = timeChangeReceiver ?: return
        try {
            unregisterReceiver(receiver)
        } catch (error: Exception) {
            // 忽略
        }
        timeChangeReceiver = null
    }

    companion object {
        /** 供外部在已经不持有引用时做一次"立刻判定" */
        fun kick(context: Context) {
            try {
                context.startForegroundService(Intent(context, LockForegroundService::class.java))
            } catch (error: Exception) {
                // 忽略
            }
        }

        fun nextBoundaryDescription(snapshot: EngineSnapshot): String =
            TimeUtils.formatDurationCN(snapshot.remainingMs)
    }
}
