package com.xideng.sleep.ui

import android.Manifest
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.xideng.sleep.XidengApp
import com.xideng.sleep.databinding.ActivityHardeningBinding
import com.xideng.sleep.databinding.ItemHardeningBinding
import com.xideng.sleep.util.ContentWidth
import com.xideng.sleep.util.Permissions

/**
 * 熄灯早睡 · 加固权限
 *
 * 把所有"能提高绕过成本"的开关集中成一页，分三组：
 *  · 基础权限 —— 不开，熄灯界面可能根本弹不出来；
 *  · 保活权限 —— 保证熄灯在夜里、在重启后仍然生效；
 *  · 防破解权限 —— 挡住强停、卸载、绕过。
 *
 * 两条自我约束：
 *  1. 每一项都必须写清"不给会怎样"，不用"为了更好的体验"这类空话；
 *  2. **不做欺骗性开关** —— 系统没有 API 的项目（屏蔽语音助手、禁止下拉菜单栏）
 *     就老实说明"需要你到系统设置里手动关"，并给一个跳转入口，而不是摆一个按不动的假开关。
 */
class HardeningActivity : AppCompatActivity() {

    private lateinit var binding: ActivityHardeningBinding
    private lateinit var graph: com.xideng.sleep.AppGraph

    private val notificationLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { render() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        graph = XidengApp.graphOf(this)
        binding = ActivityHardeningBinding.inflate(layoutInflater)
        setContentView(binding.root)
        binding.btnBack.setOnClickListener { finish() }
    }

    override fun onResume() {
        super.onResume()
        ContentWidth.cap(binding.contentColumn)
        render()
    }

    /* ───────────── 渲染 ───────────── */

    private fun render() {
        val items = buildItems()

        val required = items.filter { it.required }
        val missingRequired = required.count { !it.granted }
        val optionalMissing = items.count { !it.required && !it.granted && it.action != null }

        binding.summaryTitle.text = if (missingRequired == 0) {
            "基础权限已就位"
        } else {
            "还有 $missingRequired 项基础权限没开"
        }
        binding.summaryDetail.text = if (missingRequired == 0) {
            "熄灯界面已经能正常弹出来了。下面还有 $optionalMissing 项可以继续加固，" +
                "它们决定你在多大程度上能绕开熄灯。"
        } else {
            "这 $missingRequired 项不开启，熄灯时你可能看不到任何接管界面。" +
                "其余 ${required.size - missingRequired} 项基础权限已开启。"
        }

        val container = binding.hardeningContainer
        container.removeAllViews()

        var lastSection: Section? = null
        for (item in items) {
            if (item.section != lastSection) {
                container.addView(sectionHeader(item.section))
                lastSection = item.section
            }
            container.addView(rowFor(item))
        }
    }

    private fun sectionHeader(section: Section): View {
        val wrapper = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(4), dp(22), dp(4), dp(6))
        }
        wrapper.addView(
            TextView(this).apply {
                text = section.title
                setTextColor(ContextCompat.getColor(context, com.xideng.sleep.R.color.xideng_text_primary))
                textSize = 14f
            },
        )
        wrapper.addView(
            TextView(this).apply {
                text = section.caption
                setTextColor(ContextCompat.getColor(context, com.xideng.sleep.R.color.xideng_text_faint))
                textSize = 11f
                setPadding(0, dp(4), 0, 0)
            },
        )
        return wrapper
    }

    private fun rowFor(item: Item): View {
        val row = ItemHardeningBinding.inflate(layoutInflater, binding.hardeningContainer, false)
        row.itemTitle.text = item.title
        row.itemImpact.text = item.impact

        row.itemDot.setBackgroundResource(
            when {
                item.granted -> com.xideng.sleep.R.drawable.bg_status_ok
                item.required -> com.xideng.sleep.R.drawable.bg_status_missing
                else -> com.xideng.sleep.R.drawable.bg_status_neutral
            },
        )

        if (item.badge != null) {
            row.itemBadge.text = item.badge
            row.itemBadge.visibility = View.VISIBLE
        } else {
            row.itemBadge.visibility = View.GONE
        }

        if (item.informational) {
            row.itemAction.visibility = View.GONE
            row.root.isClickable = false
        } else {
            row.itemAction.visibility = View.VISIBLE
            row.itemAction.text = if (item.granted) item.grantedLabel else item.actionLabel
            val action = item.action
            val listener = View.OnClickListener { action?.invoke() }
            row.itemAction.setOnClickListener(listener)
            row.root.setOnClickListener(listener)
        }
        return row.root
    }

    /* ───────────── 清单定义 ───────────── */

    private enum class Section(val title: String, val caption: String) {
        BASIC("基础权限（必须开启）", "不开，熄灯时你可能根本看不到接管界面。"),
        KEEPALIVE("保活权限", "保证熄灯在夜间、重启后仍然生效，而不是“到点了却什么都没发生”。"),
        HARDEN("防破解权限", "提高绕过熄灯的成本。全部基于系统本身的机制，不做欺骗性的假开关。"),
    }

    private data class Item(
        val section: Section,
        val title: String,
        val impact: String,
        val granted: Boolean,
        val required: Boolean = false,
        val badge: String? = null,
        val actionLabel: String = "去开启",
        val grantedLabel: String = "已开启",
        val informational: Boolean = false,
        val action: (() -> Unit)? = null,
    )

    private fun buildItems(): List<Item> {
        val exactAlarmOk = Permissions.canScheduleExactAlarms(this)
        val notificationOk = Permissions.hasNotificationPermission(this)
        val iconHidden = Permissions.isLauncherIconHidden(this)

        return listOf(
            /* ── 基础权限 ── */
            Item(
                section = Section.BASIC,
                title = "悬浮窗权限",
                impact = "熄灯界面要盖在任何 App 之上弹出来，靠的就是它。不给的话，你人在桌面或别的 App 里时，熄灯界面拉不起来。",
                granted = Permissions.canDrawOverlays(this),
                required = true,
                badge = "必须",
                action = { safeStart(Permissions.overlayIntent(this)) },
            ),
            Item(
                section = Section.BASIC,
                title = "查看使用情况权限",
                impact = "无障碍之外的备用检测通道。系统的无障碍被回收时，靠它仍然能判断你切到了哪个 App。",
                granted = Permissions.hasUsageStatsAccess(this),
                required = true,
                badge = "必须",
                action = { safeStart(Permissions.usageAccessIntent()) },
            ),
            Item(
                section = Section.BASIC,
                title = "通知权限",
                impact = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    "熄灯期间显示常驻通知，降低被系统清理的概率。若你打算隐藏桌面图标，这更是唯一的入口。"
                } else {
                    "熄灯期间显示常驻通知，降低被系统清理的概率。"
                },
                granted = notificationOk,
                required = true,
                badge = "必须",
                action = {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && !notificationOk) {
                        notificationLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
                    } else {
                        safeStart(Permissions.notificationSettingsIntent(this))
                    }
                },
            ),
            Item(
                section = Section.BASIC,
                title = "精确闹钟",
                impact = "到点准时进入熄灯。不授权时系统会把触发时间推迟几分钟到十几分钟，错过入睡窗口。",
                granted = exactAlarmOk,
                required = true,
                badge = "必须",
                action = { safeStart(Permissions.exactAlarmIntent(this)) },
            ),

            /* ── 保活权限 ── */
            Item(
                section = Section.KEEPALIVE,
                title = "关闭电池优化",
                impact = "不加入白名单，夜间系统可能冻结本应用，出现“到点了没熄灯”。",
                granted = Permissions.isIgnoringBatteryOptimizations(this),
                action = { safeStart(Permissions.batteryOptimizationIntent(this)) },
            ),
            Item(
                section = Section.KEEPALIVE,
                title = "允许自启动",
                impact = "重启后自动恢复熄灯计划。没开的话，重启当晚的熄灯不会自动生效，要手动打开一次本应用。",
                granted = false,
                badge = "需手动确认",
                actionLabel = "去设置",
                grantedLabel = "去设置",
                action = { safeStart(Permissions.autostartIntent(this)) },
            ),
            Item(
                section = Section.KEEPALIVE,
                title = "允许后台运行",
                impact = "厂商的后台管理会把“长时间没打开”的应用清掉，熄灯可能中途被打断。在本应用条目里选择“手动管理”并允许后台活动。",
                granted = false,
                badge = "需手动确认",
                actionLabel = "去设置",
                grantedLabel = "去设置",
                action = { safeStart(Permissions.backgroundRunIntent(this)) },
            ),

            /* ── 防破解权限 ── */
            Item(
                section = Section.HARDEN,
                title = "无障碍辅助权限",
                impact = "熄灯时段内检测到你切到非白名单 App，立刻把你拉回熄灯界面。这是接管的主力，也是最容易被系统回收的一项。",
                granted = Permissions.isAccessibilityServiceEnabled(this),
                action = { safeStart(Permissions.accessibilityIntent()) },
            ),
            Item(
                section = Section.HARDEN,
                title = "加入设备管理器（防卸载）",
                impact = "禁用系统设置里的「强行停止」，卸载前必须先取消管理员。这是唯一能挡住强制停止的手段。本应用不申请任何设备策略。",
                granted = Permissions.isDeviceAdminActive(this),
                action = { safeStart(Permissions.deviceAdminIntent(this)) },
            ),
            Item(
                section = Section.HARDEN,
                title = "全屏意图",
                impact = "提前预告弹窗要能在锁屏上直接亮起来。Android 14 起这项需要单独授权。",
                granted = Permissions.canUseFullScreenIntent(this),
                action = { safeStart(Permissions.fullScreenIntentIntent(this)) },
            ),
            Item(
                section = Section.HARDEN,
                title = "隐藏桌面图标",
                impact = if (iconHidden) {
                    "图标已隐藏。随时可以从熄灯通知，或系统的“设置 → 应用 → 熄灯早睡”进来点这里恢复。"
                } else {
                    "眼不见心不烦。但要先确认通知权限已开——隐藏后只能从通知栏进入本应用。"
                },
                granted = iconHidden,
                actionLabel = "隐藏",
                grantedLabel = "恢复显示",
                action = {
                    if (!Permissions.hasNotificationPermission(this)) {
                        toast("请先开启通知权限，否则隐藏后将没有入口")
                    } else {
                        Permissions.setLauncherIconHidden(this, !iconHidden)
                        toast(if (!iconHidden) "桌面图标已隐藏，可从通知栏进入" else "桌面图标已恢复")
                        render()
                    }
                },
            ),
            Item(
                section = Section.HARDEN,
                title = "从多任务界面隐藏",
                impact = "熄灯界面与预告弹窗已默认不出现在最近任务列表里，避免被一键划掉。这一项无需设置，已生效。",
                granted = true,
                informational = true,
            ),
            Item(
                section = Section.HARDEN,
                title = "屏蔽语音助手",
                impact = "长按电源键或上滑可能召唤语音助手，从熄灯界面上方绕过。系统没有开放关闭接口，需要你到系统设置里手动停用或改成长按电源键关机。",
                granted = false,
                actionLabel = "去设置",
                grantedLabel = "去设置",
                action = { safeStart(Permissions.assistantSettingsIntent()) },
            ),
        )
    }

    /* ───────────── 工具 ───────────── */

    private fun safeStart(intent: Intent) {
        try {
            startActivity(intent)
        } catch (error: Exception) {
            toast("无法直接打开该设置页，请到系统设置里手动查找")
        }
    }

    private fun toast(message: String) {
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show()
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()
}
