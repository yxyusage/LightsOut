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

    /**
     * 上一次推给通知栏的「文案 + 相位」。
     *
     * ⚠️ 必须带上相位，不能只比较文案。这条通知在熄灯时会挂**全屏意图**，
     * 而全屏意图是"从后台把熄灯界面拉起来"的最后一条通路。
     * 早先只比文案，结果阶段变成 ACTIVE 但文案恰好没变（例如从别的相位回到
     * 同一个"熄灯中，距离结束还有 …"）时，通知不会重新 post，**全屏意图也就不会触发** ——
     * 表现为"挂在后台到点不熄灯，点进去才开始"。
     */
    private var lastNotificationKey: String? = null

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
        lastNotificationKey = "熄灯计划运行中|off"
        registerTimeChangeReceiver()
        // 服务被拉起来的这一刻就把看门狗和主闹钟都续上：
        // 服务可能是被看门狗拉活的，此时闹钟未必还在。
        //
        // ⚠️ 必须兜住异常。armSchedules 会碰 AlarmManager 与 SharedPreferences，
        // 任何一处抛异常都会让整个 onCreate 失败 —— 前台服务起不来，
        // 熄灯从此完全不工作，而且用户看不出原因。
        try {
            graph.controller.armSchedules()
        } catch (error: Exception) {
            // 排闹钟失败不该阻止服务启动：相位判定仍在每秒进行
        }
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
        // 服务被系统杀掉时，把主闹钟与看门狗重新排一遍：
        // 这是"服务没了但计划还在"时唯一还能把熄灯拉回来的通路
        try {
            graph.controller.armSchedules()
        } catch (error: Exception) {
            // 忽略：不能在 onDestroy 里抛异常
        }
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
        // 去重键 = 文案 + 相位。相位变化必须重新 post，否则全屏意图不会触发（见字段注释）
        val key = text + "|" + snapshot.phase.name.lowercase()
        if (key == lastNotificationKey) return
        lastNotificationKey = key
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
