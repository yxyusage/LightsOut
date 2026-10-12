package com.xideng.sleep.util

import android.Manifest
import android.app.AlarmManager
import android.app.NotificationManager
import android.app.admin.DevicePolicyManager
import android.app.usage.UsageStatsManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.os.Process
import android.provider.Settings
import androidx.core.content.ContextCompat
import com.xideng.sleep.receiver.SleepDeviceAdminReceiver
import com.xideng.sleep.service.SleepAccessibilityService

/**
 * 熄灯早睡 · 权限状态查询与跳转
 *
 * 这些判断原先散落在各 Activity 里，现在集中到一处，「加固权限」页与引导页共用同一份逻辑。
 *
 * 设计原则（重要）：
 *  1. **每一项都要能回答"不给会怎样"** —— 调用方通过 [HardeningItem.impact] 展示后果，
 *     而不是笼统地说"请授权"。
 *  2. **国产 ROM 的跳转一律给候选列表 + 兜底** —— 厂商随时可能改 Activity 名，
 *     解析不到就退到应用详情页，绝不假装成功。
 *  3. 不申请任何用不到的权限。用不到的项在清单里直接不出现。
 */
object Permissions {

    /** 桌面图标别名（见 AndroidManifest 的 `<activity-alias>`）。隐藏图标就是禁用这个组件。 */
    const val LAUNCHER_ALIAS = "com.xideng.sleep.ui.LauncherAlias"

    /* ───────────── 基础权限 ───────────── */

    /** 悬浮窗。有了它，前台服务在后台拉起熄灯界面才不会被系统拦截。 */
    fun canDrawOverlays(context: Context): Boolean = Settings.canDrawOverlays(context)

    fun overlayIntent(context: Context): Intent = Intent(
        Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
        Uri.parse("package:" + context.packageName),
    )

    /**
     * 「查看使用情况」权限。
     *
     * 它让我们能读到"当前前台是哪个应用"。这是**无障碍服务之外的备用检测通道**：
     * 无障碍被厂商 ROM 回收时，熄灯时段仍能靠它把用户拉回来。
     */
    fun hasUsageStatsAccess(context: Context): Boolean {
        val appOps = context.getSystemService(Context.APP_OPS_SERVICE) as? android.app.AppOpsManager
            ?: return false
        val mode = try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                appOps.unsafeCheckOpNoThrow(
                    android.app.AppOpsManager.OPSTR_GET_USAGE_STATS,
                    Process.myUid(),
                    context.packageName,
                )
            } else {
                @Suppress("DEPRECATION")
                appOps.checkOpNoThrow(
                    android.app.AppOpsManager.OPSTR_GET_USAGE_STATS,
                    Process.myUid(),
                    context.packageName,
                )
            }
        } catch (error: Exception) {
            return false
        }
        if (mode == android.app.AppOpsManager.MODE_DEFAULT) {
            return ContextCompat.checkSelfPermission(context, Manifest.permission.PACKAGE_USAGE_STATS) ==
                PackageManager.PERMISSION_GRANTED
        }
        return mode == android.app.AppOpsManager.MODE_ALLOWED
    }

    fun usageAccessIntent(): Intent = Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS)

    /** 读取"最近前台应用"的包名。没有授权时返回 null，调用方必须自己兜底。 */
    fun currentForegroundPackage(context: Context): String? {
        if (!hasUsageStatsAccess(context)) return null
        val manager = context.getSystemService(Context.USAGE_STATS_SERVICE) as? UsageStatsManager ?: return null
        return try {
            val now = System.currentTimeMillis()
            // 回看 60 秒：太短会在应用刚启动时读不到，太长会读到已经不存在的历史。
            val events = manager.queryEvents(now - 60_000L, now) ?: return null
            val event = android.app.usage.UsageEvents.Event()
            var last: String? = null
            while (events.hasNextEvent()) {
                events.getNextEvent(event)
                if (event.eventType == android.app.usage.UsageEvents.Event.MOVE_TO_FOREGROUND) {
                    last = event.packageName
                }
            }
            last
        } catch (error: Exception) {
            null
        }
    }

    /** 通知权限（Android 13+ 需运行时授予）。没有它熄灯仍生效，只是看不到常驻通知。 */
    fun hasNotificationPermission(context: Context): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return true
        return ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
    }

    fun notificationSettingsIntent(context: Context): Intent =
        Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
            .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)

    /* ───────────── 保活权限 ───────────── */

    /** 电池优化白名单。不加进来，夜间前台服务可能被厂商 ROM 冻结。 */
    fun isIgnoringBatteryOptimizations(context: Context): Boolean {
        val power = context.getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return false
        return try {
            power.isIgnoringBatteryOptimizations(context.packageName)
        } catch (error: Exception) {
            false
        }
    }

    fun batteryOptimizationIntent(context: Context): Intent =
        Intent(
            Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
            Uri.parse("package:" + context.packageName),
        )

    /**
     * 「允许自启动」。
     *
     * 这一项**没有标准 API**，只能靠厂商自己暴露的设置页。下面按"常见 → 罕见"排序，
     * 逐个尝试解析；全都解析不到时退回应用详情页，并让 UI 提示用户手动去找。
     */
    fun autostartIntent(context: Context): Intent =
        firstResolvable(context, AUTOSTART_CANDIDATES) ?: appDetailsIntent(context)

    /** 「允许后台运行 / 防止异常退出」。同样没有标准 API。 */
    fun backgroundRunIntent(context: Context): Intent =
        firstResolvable(context, BACKGROUND_RUN_CANDIDATES) ?: appDetailsIntent(context)

    /* ───────────── 防破解权限 ───────────── */

    /** 精确闹钟授权（Android 12+）。没有它也能用，只是触发时间可能被系统推迟。 */
    fun canScheduleExactAlarms(context: Context): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true
        val manager = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return false
        return try {
            manager.canScheduleExactAlarms()
        } catch (error: Exception) {
            false
        }
    }

    fun exactAlarmIntent(context: Context): Intent =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            Intent(
                Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,
                Uri.parse("package:" + context.packageName),
            )
        } else {
            appDetailsIntent(context)
        }

    /** 全屏意图（Android 14+）。预告弹窗要能在锁屏上直接亮起来就得靠它。 */
    fun canUseFullScreenIntent(context: Context): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) return true
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
            ?: return false
        return try {
            manager.canUseFullScreenIntent()
        } catch (error: Exception) {
            false
        }
    }

    fun fullScreenIntentIntent(context: Context): Intent =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            Intent(
                Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT,
                Uri.parse("package:" + context.packageName),
            )
        } else {
            appDetailsIntent(context)
        }

    /** 无障碍服务是否已启用。这是"检测到切走就拉回来"的主通道。 */
    fun isAccessibilityServiceEnabled(context: Context): Boolean {
        val component = ComponentName(context, SleepAccessibilityService::class.java)
        val expected = listOf(component.flattenToString(), component.flattenToShortString())
        val enabled = try {
            Settings.Secure.getString(
                context.contentResolver,
                Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES,
            )
        } catch (error: Exception) {
            null
        } ?: return false
        return enabled.split(':').any { entry ->
            expected.any { it.equals(entry.trim(), ignoreCase = true) }
        }
    }

    fun accessibilityIntent(): Intent = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)

    /** 设备管理员是否已激活：禁用「强行停止」、卸载前必须先去激活。 */
    fun isDeviceAdminActive(context: Context): Boolean {
        val manager = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as? DevicePolicyManager
            ?: return false
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
                "开启后，系统设置里的「强行停止」会被禁用，卸载前也必须先取消设备管理员。" +
                    "本应用不申请任何设备策略，不会锁屏、不会清数据、不会改密码。",
            )

    /* ───────────── 隐蔽性开关（都不是"权限"，而是可切换的能力）───────────── */

    /** 桌面图标是否被隐藏（通过禁用 launcher activity-alias 实现）。 */
    fun isLauncherIconHidden(context: Context): Boolean = try {
        context.packageManager.getComponentEnabledSetting(ComponentName(context.packageName, LAUNCHER_ALIAS)) ==
            PackageManager.COMPONENT_ENABLED_STATE_DISABLED
    } catch (error: Exception) {
        false
    }

    /**
     * 隐藏 / 恢复桌面图标。
     *
     * ⚠️ 隐藏后 App 只能从通知栏或系统设置的已安装应用列表进入，
     * 所以调用方**必须先**确保常驻通知可用，否则用户会以为 App 消失了。
     */
    fun setLauncherIconHidden(context: Context, hidden: Boolean) {
        val state = if (hidden) {
            PackageManager.COMPONENT_ENABLED_STATE_DISABLED
        } else {
            PackageManager.COMPONENT_ENABLED_STATE_ENABLED
        }
        try {
            context.packageManager.setComponentEnabledSetting(
                ComponentName(context.packageName, LAUNCHER_ALIAS),
                state,
                PackageManager.DONT_KILL_APP,
            )
        } catch (error: Exception) {
            // 个别 ROM 会拒绝修改组件状态；失败时保持原样，不抛给 UI。
        }
    }

    /** 屏蔽语音助手（长按电源键 / 上滑召唤）。只能引导用户去系统设置里关。 */
    fun assistantSettingsIntent(): Intent =
        Intent(Settings.ACTION_VOICE_INPUT_SETTINGS)

    fun appDetailsIntent(context: Context): Intent = Intent(
        Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
        Uri.parse("package:" + context.packageName),
    )

    /* ───────────── 内部工具 ───────────── */

    /** 返回第一个能被系统解析的候选 Activity；一个都解析不到时返回 null。 */
    private fun firstResolvable(context: Context, candidates: List<String>): Intent? {
        for (flat in candidates) {
            val component = ComponentName.unflattenFromString(flat) ?: continue
            val intent = Intent().setComponent(component).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            if (context.packageManager.resolveActivity(intent, 0) != null) return intent
        }
        return null
    }

    /**
     * 厂商自启动管理页候选。
     *
     * 荣耀/华为系在本机（HONOR ROL-W10）实测存在 `com.hihonor.systemmanager`，
     * 其余为各厂商常见入口。顺序即优先级。
     */
    private val AUTOSTART_CANDIDATES = listOf(
        // 荣耀 / 华为
        "com.hihonor.systemmanager/com.hihonor.systemmanager.startupmgr.ui.StartupNormalAppListActivity",
        "com.hihonor.systemmanager/.startupmgr.ui.StartupNormalAppListActivity",
        "com.huawei.systemmanager/.startupmgr.ui.StartupNormalAppListActivity",
        // 小米
        "com.miui.securitycenter/com.miui.permcenter.autostart.AutoStartManagementActivity",
        // OPPO / 一加
        "com.coloros.safecenter/.permission.startup.StartupAppListActivity",
        "com.oppo.safe/.permission.startup.StartupAppListActivity",
        // vivo / iQOO
        "com.vivo.permissionmanager/.activity.BgStartUpManagerActivity",
        "com.iqoo.secure/.ui.phoneoptimize.AddWhiteListActivity",
        // 三星 / 魅族
        "com.samsung.android.lool/.activity.BatteryActivity",
        "com.meizu.safe/.security.SecureMainActivity",
    )

    /** 「应用启动管理 / 后台运行」候选，用于"防止异常退出"这一项。 */
    private val BACKGROUND_RUN_CANDIDATES = listOf(
        "com.hihonor.systemmanager/com.hihonor.systemmanager.appcontrol.activity.StartupAppControlActivity",
        "com.hihonor.systemmanager/.appcontrol.activity.StartupAppControlActivity",
        "com.huawei.systemmanager/.appcontrol.activity.StartupAppControlActivity",
        "com.miui.powerkeeper/.ui.HideAppsActivity",
        "com.coloros.oppoguardelf/.powermanager.PowerActivity",
        "com.vivo.pem/.PemActivity",
    )
}
