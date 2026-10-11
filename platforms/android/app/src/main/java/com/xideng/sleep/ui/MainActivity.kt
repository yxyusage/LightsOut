package com.xideng.sleep.ui

import android.Manifest
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import com.xideng.sleep.AppGraph
import com.xideng.sleep.XidengApp
import com.xideng.sleep.core.Constants
import com.xideng.sleep.core.Phase
import com.xideng.sleep.core.TimeUtils
import com.xideng.sleep.databinding.ActivityMainBinding
import com.xideng.sleep.databinding.ItemPermissionBinding
import com.xideng.sleep.lock.AlarmScheduler
import com.xideng.sleep.util.Permissions

/**
 * 熄灯早睡 · 主界面
 *
 * 三件事：
 *  1. 展示当前相位（是否在熄灯中、下一次熄灯何时开始、本周还剩几次解除额度）；
 *  2. 把 PRD 五、5.1 需要的权限做成一份可勾选的清单，每项都说明"不给会怎样"；
 *  3. 提供进入设置的入口，以及"预览预告弹窗""演示熄灯界面"两个给评审用的快捷入口。
 */
class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private lateinit var graph: AppGraph
    private val handler = Handler(Looper.getMainLooper())

    private val notificationPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { render() }

    private val phoneStatePermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { render() }

    private val ticker = object : Runnable {
        override fun run() {
            render()
            handler.postDelayed(this, TICK_MS)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        graph = XidengApp.graphOf(this)

        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        binding.btnSettings.setOnClickListener {
            startActivity(Intent(this, SettingsActivity::class.java))
        }
        binding.btnPreviewWarning.setOnClickListener {
            WarningActivity.launchPreview(this)
        }
        binding.btnDemoBlackout.setOnClickListener {
            graph.controller.startDemo(DEMO_DURATION_MS)
            toast("演示模式已开启，2 分钟后自动结束")
        }
        binding.btnEmergency.setOnClickListener {
            startActivity(Intent(this, EmergencyActivity::class.java))
        }

        binding.footerText.text = "熄灯早睡 v" + Constants.VERSION +
            " · Android 原生版\n" +
            "所有设置、密码与用量记录只保存在本机，不上传任何服务器。"
    }

    override fun onResume() {
        super.onResume()
        // 从主界面进来时顺手把前台服务与闹钟都安排上（用户在前台，启动前台服务一定合法）
        graph.controller.startLockService()
        graph.controller.tick("main-resume", force = true)
        render()
        handler.removeCallbacks(ticker)
        handler.post(ticker)
    }

    override fun onPause() {
        handler.removeCallbacks(ticker)
        super.onPause()
    }

    private fun render() {
        val snapshot = graph.engine.snapshot()

        val phaseLabel = when (snapshot.phase) {
            Phase.ACTIVE -> "熄灯中"
            Phase.WARNING -> "即将熄灯"
            Phase.IDLE -> "计划生效中"
            Phase.OFF -> "计划已关闭"
        }
        binding.phaseText.text = phaseLabel

        val detail = StringBuilder()
        detail.append(graph.controller.describePhase(snapshot))
        if (snapshot.phase == Phase.ACTIVE && snapshot.windowEnd != null) {
            detail.append("\n预计 " + TimeUtils.formatClock(TimeUtils.localDateTime(snapshot.windowEnd)) + " 结束")
        }
        detail.append("\n").append(AlarmScheduler.describeNext(snapshot.settings.plan))
        binding.detailText.text = detail.toString()

        binding.quotaText.text = "本周剩余解除次数：" + snapshot.quota.remaining + " / " + snapshot.quota.total +
            "（自然周周一 0 点重置）"

        renderPermissions()
    }

    private fun renderPermissions() {
        val container = binding.permissionContainer
        container.removeAllViews()
        for (item in permissionItems()) {
            val row = ItemPermissionBinding.inflate(layoutInflater, container, false)
            row.permTitle.text = item.title
            row.permSubtitle.text = item.subtitle
            if (item.granted) {
                row.permAction.text = "已授权"
                row.permAction.isEnabled = false
                row.permAction.setOnClickListener(null)
            } else {
                row.permAction.text = "去授权"
                row.permAction.isEnabled = true
                row.permAction.setOnClickListener { item.onAction() }
            }
            container.addView(row.root)
        }
    }

    private data class PermissionItem(
        val title: String,
        val subtitle: String,
        val granted: Boolean,
        val onAction: () -> Unit,
    )

    private fun permissionItems(): List<PermissionItem> = listOf(
        PermissionItem(
            "通知权限",
            "常驻通知栏，降低被系统后台清理的概率（PRD 三）",
            Permissions.hasNotificationPermission(this),
        ) { requestNotifications() },
        PermissionItem(
            "悬浮窗权限",
            "让前台服务能在后台合法地拉起熄灯界面（PRD 5.1）",
            Permissions.canDrawOverlays(this),
        ) { safeStart(Permissions.overlayIntent(this)) },
        PermissionItem(
            "电池优化白名单",
            "避免夜间前台服务被系统或厂商 ROM 冻结（PRD 三）",
            Permissions.isIgnoringBatteryOptimizations(this),
        ) { safeStart(Permissions.batteryOptimizationIntent(this)) },
        PermissionItem(
            "精确闹钟",
            "让熄灯在设定时刻准时触发（PRD 2.2.1）。未授权时自动退化为非精确闹钟，功能不失效",
            Permissions.canScheduleExactAlarms(this),
        ) { safeStart(Permissions.exactAlarmIntent(this)) },
        PermissionItem(
            "无障碍服务",
            "熄灯时段检测到非白名单应用时，立刻把你送回熄灯界面（PRD 三）",
            Permissions.isAccessibilityServiceEnabled(this),
        ) { safeStart(Permissions.accessibilityIntent()) },
        PermissionItem(
            "设备管理员",
            "禁用系统设置里的「强行停止」，卸载前必须先取消管理员（PRD 三）",
            Permissions.isDeviceAdminActive(this),
        ) { safeStart(Permissions.deviceAdminIntent(this)) },
        PermissionItem(
            "读取电话状态（可跳过）",
            "识别来电并放行通话（PRD 2.2.4）。不授权时会改用系统音频模式判定，功能不受影响",
            Permissions.hasPhoneStatePermission(this),
        ) { requestPhoneState() },
    )

    private fun requestNotifications() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        } else {
            safeStart(Permissions.appDetailsIntent(this))
        }
    }

    private fun requestPhoneState() {
        phoneStatePermissionLauncher.launch(Manifest.permission.READ_PHONE_STATE)
    }

    private fun safeStart(intent: Intent) {
        try {
            startActivity(intent)
        } catch (error: Exception) {
            toast("无法直接打开该设置页，请到系统设置里手动开启")
        }
    }

    companion object {
        private const val TICK_MS = 1_000L
        private const val DEMO_DURATION_MS = 2 * 60_000L
    }
}
