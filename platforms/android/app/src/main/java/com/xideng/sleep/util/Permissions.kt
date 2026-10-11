package com.xideng.sleep.util

import android.Manifest
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.core.content.ContextCompat
import com.xideng.sleep.receiver.SleepDeviceAdminReceiver
import com.xideng.sleep.service.SleepAccessibilityService

/**
 * 熄灯早睡 · 权限状态查询与跳转（PRD 五、5.1）
 *
 * 把这些散落在各处的 `Settings.Secure` / `DevicePolicyManager` 判断集中到一处，
 * 主界面就能用同一份逻辑渲染"权限清单"。
 */
object Permissions {

    /** 悬浮窗（PRD 5.1）。有了它，前台服务在后台拉起熄灯界面才不会被系统拦截。 */
    fun canDrawOverlays(context: Context): Boolean =
        Settings.canDrawOverlays(context)

    fun overlayIntent(context: Context): Intent = Intent(
        Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
        Uri.parse("package:" + context.packageName),
    )

    /** 电池优化白名单。不加进来，夜间前台服务可能被厂商 ROM 冻结。 */
    fun isIgnoringBatteryOptimizations(context: Context): Boolean {
        val power = context.getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return false
        return power.isIgnoringBatteryOptimizations(context.packageName)
    }

    fun batteryOptimizationIntent(context: Context): Intent =
        Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + context.packageName))

    /** 精确闹钟授权（Android 12+）。没有它也能用，只是触发时间可能被系统推迟。 */
    fun canScheduleExactAlarms(context: Context): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true
        val manager = context.getSystemService(Context.ALARM_SERVICE) as? android.app.AlarmManager ?: return false
        return manager.canScheduleExactAlarms()
    }

    fun exactAlarmIntent(context: Context): Intent =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:" + context.packageName))
        } else {
            appDetailsIntent(context)
        }

    /** 通知权限（Android 13+ 需运行时授予）。没有它熄灯仍生效，只是看不到常驻通知。 */
    fun hasNotificationPermission(context: Context): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return true
        return ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
    }

    /** 读取电话状态（PRD 2.2.4）。未授权时退回 AudioManager 判定来电，功能不受影响。 */
    fun hasPhoneStatePermission(context: Context): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.READ_PHONE_STATE) ==
            PackageManager.PERMISSION_GRANTED

    /** 无障碍服务是否已启用（PRD 三：监听前台应用包名） */
    fun isAccessibilityServiceEnabled(context: Context): Boolean {
        val component = ComponentName(context, SleepAccessibilityService::class.java)
        val expected = listOf(component.flattenToString(), component.flattenToShortString())
        val enabled = Settings.Secure.getString(
            context.contentResolver,
            Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES,
        ) ?: return false
        return enabled.split(':').any { entry ->
            expected.any { it.equals(entry.trim(), ignoreCase = true) }
        }
    }

    fun accessibilityIntent(): Intent = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)

    /** 设备管理员是否已激活（PRD 三：防强制停止、防卸载） */
    fun isDeviceAdminActive(context: Context): Boolean {
        val manager = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as? DevicePolicyManager ?: return false
        return try {
            manager.isAdminActive(ComponentName(context, SleepDeviceAdminReceiver::class.java))
        } catch (error: Exception) {
            false
        }
    }

    fun deviceAdminIntent(context: Context): Intent =
        Intent(DevicePolicyManager.ACTION_ADD_DEVICE_ADMIN)
            .putExtra(
                DevicePolicyManager.EXTRA_DEVICE_ADMIN,
                ComponentName(context, SleepDeviceAdminReceiver::class.java),
            )
            .putExtra(
                DevicePolicyManager.EXTRA_ADD_EXPLANATION,
                "开启后，系统设置里的「强行停止」会被禁用，卸载前也必须先取消设备管理员——" +
                    "这是（PRD 三）防绕过体系里唯一的系统级减速带。本应用不申请任何设备策略，不会锁屏、不会清数据。",
            )

    fun appDetailsIntent(context: Context): Intent = Intent(
        Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
        Uri.parse("package:" + context.packageName),
    )
}
