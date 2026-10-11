package com.xideng.sleep.util

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import com.xideng.sleep.R
import com.xideng.sleep.core.Constants
import com.xideng.sleep.ui.BlackoutActivity
import com.xideng.sleep.ui.MainActivity

/**
 * 熄灯早睡 · 通知
 *
 * 三条通道：熄灯计划（常驻）、助眠音频（常驻）、熄灯提醒（提前预告）。
 * 预告通知带 **full-screen intent**，这是"锁屏状态下自动点亮并显示预告弹窗"
 * 唯一被 Android 官方允许的方式（PRD 2.1.2）。
 */
object NotificationHelper {

    fun ensureChannels(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return

        manager.createNotificationChannel(
            NotificationChannel(
                Constants.CHANNEL_LOCK,
                context.getString(R.string.channel_lock_name),
                NotificationManager.IMPORTANCE_LOW,
            ).apply {
                description = context.getString(R.string.channel_lock_description)
                setShowBadge(false)
            },
        )

        manager.createNotificationChannel(
            NotificationChannel(
                Constants.CHANNEL_AUDIO,
                context.getString(R.string.channel_audio_name),
                NotificationManager.IMPORTANCE_LOW,
            ).apply {
                description = context.getString(R.string.channel_audio_description)
                setShowBadge(false)
            },
        )

        manager.createNotificationChannel(
            NotificationChannel(
                Constants.CHANNEL_ALERT,
                context.getString(R.string.channel_alert_name),
                NotificationManager.IMPORTANCE_HIGH,
            ).apply {
                description = context.getString(R.string.channel_alert_description)
                setShowBadge(true)
            },
        )
    }

    /** 熄灯计划常驻通知。点击回到主界面，不提供"退出"按钮——退出只能走紧急解除。 */
    fun buildLockNotification(context: Context, text: String, withFullScreen: Boolean): Notification {
        val contentIntent = PendingIntent.getActivity(
            context,
            1,
            Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val builder = NotificationCompat.Builder(context, Constants.CHANNEL_LOCK)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(context.getString(R.string.app_name))
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setOngoing(true)
            .setSilent(true)
            .setShowWhen(false)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setContentIntent(contentIntent)

        if (withFullScreen) {
            val blackoutIntent = PendingIntent.getActivity(
                context,
                2,
                Intent(context, BlackoutActivity::class.java)
                    .setAction(BlackoutActivity.ACTION_ENTER)
                    .addFlags(
                        Intent.FLAG_ACTIVITY_NEW_TASK or
                            Intent.FLAG_ACTIVITY_SINGLE_TOP or
                            Intent.FLAG_ACTIVITY_REORDER_TO_FRONT,
                    ),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
            builder.setFullScreenIntent(blackoutIntent, true)
        }

        return builder.build()
    }

    /** 提前预告通知，带全屏意图 -> 锁屏上直接弹出不可关闭的预告界面 */
    fun buildWarningNotification(context: Context, text: String): Notification {
        val intent = PendingIntent.getActivity(
            context,
            3,
            Intent(context, com.xideng.sleep.ui.WarningActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        return NotificationCompat.Builder(context, Constants.CHANNEL_ALERT)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("即将进入熄灯模式")
            .setContentText(text)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setAutoCancel(false)
            .setOngoing(true)
            .setContentIntent(intent)
            .setFullScreenIntent(intent, true)
            .build()
    }

    /** 助眠音频通知（PRD 2.3，同一通知栏入口可关闭音频） */
    fun buildAudioNotification(context: Context, text: String): Notification {
        val stopIntent = PendingIntent.getService(
            context,
            4,
            Intent(context, com.xideng.sleep.service.AudioService::class.java)
                .setAction(com.xideng.sleep.service.AudioService.ACTION_STOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        return NotificationCompat.Builder(context, Constants.CHANNEL_AUDIO)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("助眠音频")
            .setContentText(text)
            .setOngoing(true)
            .setSilent(true)
            .setShowWhen(false)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .addAction(0, "关闭", stopIntent)
            .build()
    }

    fun post(context: Context, id: Int, notification: Notification) {
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return
        try {
            manager.notify(id, notification)
        } catch (error: SecurityException) {
            // Android 13+ 未授予通知权限时会抛异常：不通知也要保证熄灯流程继续
        }
    }

    fun cancel(context: Context, id: Int) {
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return
        try {
            manager.cancel(id)
        } catch (error: Exception) {
            // 忽略
        }
    }
}
