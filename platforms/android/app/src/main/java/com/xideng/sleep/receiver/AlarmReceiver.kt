package com.xideng.sleep.receiver

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.xideng.sleep.XidengApp

/**
 * 熄灯早睡 · 到点唤醒（PRD 2.2.1）
 *
 * 这是"服务被系统杀掉之后仍能到点熄灯"的兜底路径。
 * 服务活着的时候，它自己按秒判定，这个广播只是把相位再确认一次。
 */
class AlarmReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent?) {
        try {
            XidengApp.graphOf(context).controller.onAlarm()
        } catch (error: Exception) {
            // 忽略
        }
    }
}
