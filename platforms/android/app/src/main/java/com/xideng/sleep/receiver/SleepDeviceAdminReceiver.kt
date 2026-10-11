package com.xideng.sleep.receiver

import android.app.admin.DeviceAdminReceiver
import android.content.Context
import android.content.Intent

/**
 * 熄灯早睡 · 设备管理员（PRD 三：禁止强制停止、防卸载）
 *
 * 本接收器**不申请任何设备策略**（见 res/xml/device_admin.xml）。
 * 它存在的唯一意义是让系统知道"这个应用是活跃的设备管理员"，从而：
 *  · 在系统设置里禁用「强行停止」按钮；
 *  · 卸载前必须先手动取消设备管理员。
 *
 * 这是一个明确的减速带，不是不可绕过的锁——诚实地把它写在这里，
 * 也写在 README 的已知限制里。
 */
class SleepDeviceAdminReceiver : DeviceAdminReceiver() {

    override fun onEnabled(context: Context, intent: Intent) {
        super.onEnabled(context, intent)
    }

    override fun onDisabled(context: Context, intent: Intent) {
        super.onDisabled(context, intent)
    }

    /** 用户在系统设置里尝试取消设备管理员时弹出的说明 */
    override fun onDisableRequested(context: Context, intent: Intent): CharSequence {
        return "取消后，熄灯模式将失去「防强制停止 / 防卸载」这道系统级保护，" +
            "在熄灯时段内更容易被绕过。确定要取消吗？"
    }
}
