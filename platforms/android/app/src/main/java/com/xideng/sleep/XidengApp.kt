package com.xideng.sleep

import android.app.Application
import android.content.Context
import com.xideng.sleep.util.NotificationHelper

/**
 * 熄灯早睡 · Application
 *
 * [AppGraph] 是进程级单例，被前台服务、无障碍服务、各 Activity 与广播接收器共用。
 * 进程被系统回收后重建时，所有状态都会从 SharedPreferences 重新读回，
 * 不会因为"服务重启"而丢失熄灯计划或额度。
 */
class XidengApp : Application() {

    lateinit var graph: AppGraph
        private set

    override fun onCreate() {
        super.onCreate()
        graph = AppGraph(this)
        NotificationHelper.ensureChannels(this)
    }

    companion object {
        fun graphOf(context: Context): AppGraph = (context.applicationContext as XidengApp).graph
    }
}
