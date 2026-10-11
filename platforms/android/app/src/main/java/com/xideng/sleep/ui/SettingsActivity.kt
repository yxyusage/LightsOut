package com.xideng.sleep.ui

import android.app.TimePickerDialog
import android.os.Bundle
import android.text.InputType
import android.view.View
import android.widget.EditText
import android.widget.SeekBar
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.widget.SwitchCompat
import com.xideng.sleep.AppGraph
import com.xideng.sleep.XidengApp
import com.xideng.sleep.audio.NoiseSynth
import com.xideng.sleep.core.Constants
import com.xideng.sleep.core.CopyLibrary
import com.xideng.sleep.core.DayType
import com.xideng.sleep.core.Holidays
import com.xideng.sleep.core.PasswordHasher
import com.xideng.sleep.core.PlanWindow
import com.xideng.sleep.core.SceneDetector
import com.xideng.sleep.core.Schedule
import com.xideng.sleep.core.TimeUtils
import com.xideng.sleep.core.WhitelistApp
import com.xideng.sleep.databinding.ActivitySettingsBinding
import com.xideng.sleep.databinding.ItemWhitelistAppBinding
import com.xideng.sleep.lock.AlarmScheduler
import java.time.LocalDateTime

/**
 * 熄灯早睡 · 设置
 *
 * 覆盖 PRD 2.1（睡眠计划）、2.2.3（白名单与总时长）、2.3（助眠音频）、2.4（AI 文案）、
 * 2.2.5 / 三（密码、额度、违规记录）以及数据溯源展示。
 *
 * 所有写入都通过 [com.xideng.sleep.core.SettingsStore]，因此迁移、夹取与订阅通知都自动生效。
 */
class SettingsActivity : AppCompatActivity() {

    private lateinit var binding: ActivitySettingsBinding
    private lateinit var graph: AppGraph
    private var updatingUi = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        graph = XidengApp.graphOf(this)

        binding = ActivitySettingsBinding.inflate(layoutInflater)
        setContentView(binding.root)

        wirePlan()
        wireWhitelist()
        wireAudio()
        wireAi()
        wireSecurity()
    }

    override fun onResume() {
        super.onResume()
        render()
    }

    /* ═════════════ 睡眠计划（PRD 2.1） ═════════════ */

    private fun wirePlan() {
        binding.switchPlanEnabled.setOnCheckedChangeListener { _: SwitchCompat, checked: Boolean ->
            if (updatingUi) return@setOnCheckedChangeListener
            graph.settingsStore.update { it.copy(plan = it.plan.copy(enabled = checked)) }
            afterChange()
        }
        binding.btnWeekdayWindow.setOnClickListener { editWindow(DayType.WEEKDAY) }
        binding.btnWeekendWindow.setOnClickListener { editWindow(DayType.WEEKEND) }
        binding.btnWarnMinutes.setOnClickListener { pickWarnMinutes() }
    }

    private fun editWindow(dayType: DayType) {
        val current = graph.settingsStore.value.plan.windowOf(dayType) ?: PlanWindow("23:00", "07:00")
        pickTime(dayType.label + "熄灯开始时间", current.start) { start ->
            pickTime(dayType.label + "熄灯结束时间", current.end) { end ->
                val problems = Schedule.validateWindow(start, end)
                if (problems.isNotEmpty()) {
                    toast(problems[0])
                    return@pickTime
                }
                graph.settingsStore.update { settings ->
                    settings.copy(plan = settings.plan.withWindow(dayType, PlanWindow(start, end)))
                }
                afterChange()
                render()
            }
        }
    }

    private fun pickTime(title: String, initial: String, onPicked: (String) -> Unit) {
        val minutes = try {
            TimeUtils.toMinutes(initial)
        } catch (error: IllegalArgumentException) {
            23 * 60
        }
        TimePickerDialog(
            this,
            { _, hour, minute -> onPicked(TimeUtils.pad2(hour) + ":" + TimeUtils.pad2(minute)) },
            minutes / 60,
            minutes % 60,
            true,
        ).apply { setTitle(title) }.show()
    }

    private fun pickWarnMinutes() {
        val options = Constants.WARN_MINUTE_OPTIONS
        val labels = options.map { "$it 分钟" }.toTypedArray()
        val checked = options.indexOf(graph.settingsStore.value.plan.warnMinutes)
        AlertDialog.Builder(this)
            .setTitle("提前提醒")
            .setSingleChoiceItems(labels, if (checked >= 0) checked else 1) { dialog, which ->
                graph.settingsStore.update { it.copy(plan = it.plan.copy(warnMinutes = options[which])) }
                dialog.dismiss()
                afterChange()
                render()
            }
            .setNegativeButton("取消", null)
            .show()
    }

    /* ═════════════ 白名单（PRD 2.2.3） ═════════════ */

    private fun wireWhitelist() {
        binding.btnWhitelistTotal.setOnClickListener { pickWhitelistTotal() }
        binding.btnAddWhitelistApp.setOnClickListener { pickWhitelistApp() }
    }

    private fun pickWhitelistTotal() {
        val options = (Constants.WHITELIST_TOTAL_MINUTES_MIN..Constants.WHITELIST_TOTAL_MINUTES_MAX step 5).toList()
        val labels = options.map { "$it 分钟" }.toTypedArray()
        val checked = options.indexOf(graph.settingsStore.value.whitelist.totalMinutes)
        AlertDialog.Builder(this)
            .setTitle("白名单总可用时长（上限 " + Constants.WHITELIST_TOTAL_MINUTES_MAX + " 分钟）")
            .setSingleChoiceItems(labels, if (checked >= 0) checked else options.indexOf(30)) { dialog, which ->
                graph.settingsStore.update {
                    it.copy(whitelist = it.whitelist.copy(totalMinutes = options[which]))
                }
                dialog.dismiss()
                afterChange()
                render()
            }
            .setNegativeButton("取消", null)
            .show()
    }

    /**
     * 从已安装的可启动应用里挑一个加进白名单。
     * 读取应用列表在后台线程做——包管理器在装了几百个应用的机器上会明显卡顿。
     */
    private fun pickWhitelistApp() {
        toast("正在读取应用列表…")
        graph.ioExecutor.execute {
            val apps = installedLaunchableApps()
            runOnUiThread {
                if (apps.isEmpty()) {
                    toast("没有读取到可启动的应用")
                    return@runOnUiThread
                }
                val labels = apps.map { it.second }.toTypedArray()
                AlertDialog.Builder(this)
                    .setTitle("选择要加入白名单的应用")
                    .setItems(labels) { _, which -> addWhitelistApp(apps[which].first, apps[which].second) }
                    .setNegativeButton("取消", null)
                    .show()
            }
        }
    }

    private fun installedLaunchableApps(): List<Pair<String, String>> {
        val intent = android.content.Intent(android.content.Intent.ACTION_MAIN)
            .addCategory(android.content.Intent.CATEGORY_LAUNCHER)
        val resolved = try {
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU) {
                packageManager.queryIntentActivities(intent, android.content.pm.PackageManager.ResolveInfoFlags.of(0L))
            } else {
                @Suppress("DEPRECATION")
                packageManager.queryIntentActivities(intent, 0)
            }
        } catch (error: Exception) {
            emptyList()
        }

        val unique = LinkedHashMap<String, String>()
        for (info in resolved) {
            val packageName = info.activityInfo?.packageName ?: continue
            if (packageName == this.packageName) continue
            if (unique.containsKey(packageName)) continue
            val label = try {
                info.loadLabel(packageManager).toString()
            } catch (error: Exception) {
                packageName
            }
            unique[packageName] = label
        }
        return unique.entries.map { it.key to it.value }.sortedBy { it.second }
    }

    private fun addWhitelistApp(packageName: String, label: String) {
        val apps = graph.settingsStore.value.whitelist.apps
        if (apps.any { it.packageName == packageName }) {
            toast("「" + label + "」已经在白名单里了")
            return
        }
        if (apps.size >= Constants.MAX_WHITELIST_APPS) {
            toast("最多添加 " + Constants.MAX_WHITELIST_APPS + " 个应用")
            return
        }
        val app = WhitelistApp(
            id = "app-" + System.currentTimeMillis().toString(36),
            name = label,
            system = false,
            removable = true,
            countsAgainstQuota = true,
            packageName = packageName,
        )
        graph.settingsStore.update { it.copy(whitelist = it.whitelist.copy(apps = apps + app)) }
        afterChange()
        render()
    }

    private fun removeWhitelistApp(id: String) {
        graph.settingsStore.update { settings ->
            settings.copy(
                whitelist = settings.whitelist.copy(
                    apps = settings.whitelist.apps.filter { it.id != id || !it.removable },
                ),
            )
        }
        afterChange()
        render()
    }

    /* ═════════════ 助眠音频（PRD 2.3） ═════════════ */

    private fun wireAudio() {
        binding.btnAudioPreset.setOnClickListener { pickAudioPreset() }
        binding.btnAudioDuration.setOnClickListener { pickAudioDuration() }
        binding.seekAudioVolume.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(seekBar: SeekBar?, progress: Int, fromUser: Boolean) {
                if (!fromUser || updatingUi) return
                graph.settingsStore.update { it.copy(audio = it.audio.copy(volume = progress / 100.0)) }
                binding.audioVolumeLabel.text = "音量 " + progress + "%"
            }

            override fun onStartTrackingTouch(seekBar: SeekBar?) = Unit
            override fun onStopTrackingTouch(seekBar: SeekBar?) = Unit
        })
    }

    private fun pickAudioPreset() {
        val presets = NoiseSynth.PRESETS
        val labels = presets.map { it.label + " · " + it.description }.toTypedArray()
        val checked = presets.indexOfFirst { it.id == graph.settingsStore.value.audio.preset }
        AlertDialog.Builder(this)
            .setTitle("助眠音色（实时合成，无音频素材）")
            .setSingleChoiceItems(labels, if (checked >= 0) checked else 0) { dialog, which ->
                graph.settingsStore.update { it.copy(audio = it.audio.copy(preset = presets[which].id)) }
                dialog.dismiss()
                render()
            }
            .setNegativeButton("取消", null)
            .show()
    }

    private fun pickAudioDuration() {
        val options = NoiseSynth.DURATION_OPTIONS
        val labels = options.map { it.second }.toTypedArray()
        val checked = options.indexOfFirst { it.first == graph.settingsStore.value.audio.durationMinutes }
        AlertDialog.Builder(this)
            .setTitle("播放时长")
            .setSingleChoiceItems(labels, if (checked >= 0) checked else 1) { dialog, which ->
                graph.settingsStore.update {
                    it.copy(audio = it.audio.copy(durationMinutes = options[which].first))
                }
                dialog.dismiss()
                render()
            }
            .setNegativeButton("取消", null)
            .show()
    }

    /* ═════════════ AI 文案（PRD 2.4） ═════════════ */

    private fun wireAi() {
        binding.switchAiEnabled.setOnCheckedChangeListener { _: SwitchCompat, checked: Boolean ->
            if (updatingUi) return@setOnCheckedChangeListener
            graph.settingsStore.update { it.copy(ai = it.ai.copy(enabled = checked)) }
            render()
        }
        binding.btnSaveAi.setOnClickListener { saveAi() }
        binding.btnTestAi.setOnClickListener { testAi() }
    }

    private fun saveAi() {
        val baseUrl = binding.inputAiBaseUrl.text.toString().trim()
        val model = binding.inputAiModel.text.toString().trim()
        val apiKey = binding.inputAiApiKey.text.toString().trim()
        graph.settingsStore.update {
            it.copy(
                ai = it.ai.copy(
                    baseUrl = baseUrl.ifBlank { it.ai.baseUrl },
                    model = model.ifBlank { it.ai.model },
                    apiKey = apiKey,
                ),
            )
        }
        toast("AI 配置已保存（Key 只存在本机）")
        render()
    }

    private fun testAi() {
        saveAi()
        val config = graph.settingsStore.value.ai
        if (config.apiKey.isEmpty()) {
            binding.aiStatusText.text = "请先填写 API Key"
            return
        }
        binding.aiStatusText.text = "正在测试连接…"
        graph.ai.clearCache()
        graph.ioExecutor.execute {
            val result = graph.ai.generate(SceneDetector.detect(LocalDateTime.now()))
            runOnUiThread {
                binding.aiStatusText.text = if (result.ok) {
                    "连接成功，返回文案：" + result.text
                } else {
                    "调用失败：" + describeAiFailure(result.reason)
                }
            }
        }
    }

    private fun describeAiFailure(reason: String?): String = when (reason) {
        "http-401" -> "API Key 无效（401）"
        "http-403" -> "无权访问该模型（403）"
        "http-404" -> "接口地址或模型名称不存在（404）"
        "http-429" -> "请求过于频繁或额度不足（429）"
        "network" -> "网络不可达，或接口地址填写有误"
        "empty-response" -> "接口返回内容为空"
        "disabled" -> "AI 功能未启用"
        "no-api-key" -> "未填写 API Key"
        else -> reason ?: "未知错误"
    }

    /* ═════════════ 安全与额度（PRD 2.2.5 / 三） ═════════════ */

    private fun wireSecurity() {
        binding.btnChangePassword.setOnClickListener { changePassword() }
        binding.btnResetQuota.setOnClickListener { resetQuota() }
        binding.btnClearData.setOnClickListener { confirmClearData() }
    }

    private fun changePassword() {
        val input = EditText(this).apply {
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
            hint = "4-32 位，建议混合字母"
        }
        AlertDialog.Builder(this)
            .setTitle("设置紧急解除密码")
            .setView(input)
            .setPositiveButton("保存") { _, _ ->
                val value = input.text.toString()
                val advice = PasswordHasher.advice(value)
                if (advice.isNotEmpty()) {
                    toast(advice[0])
                    return@setPositiveButton
                }
                graph.settingsStore.update {
                    it.copy(emergency = it.emergency.copy(passwordHash = PasswordHasher.hash(value)))
                }
                toast("密码已更新")
            }
            .setNegativeButton("取消", null)
            .show()
    }

    private fun resetQuota() {
        AlertDialog.Builder(this)
            .setTitle("重置本周解除额度")
            .setMessage("这会把本周已使用的解除次数清零，仅用于调试或误操作恢复。确定继续？")
            .setPositiveButton("重置") { _, _ ->
                graph.quotaStore.reset(java.time.LocalDate.now())
                toast("本周解除额度已重置")
                render()
            }
            .setNegativeButton("取消", null)
            .show()
    }

    private fun confirmClearData() {
        AlertDialog.Builder(this)
            .setTitle("清除全部本地数据")
            .setMessage("将清除本机保存的全部设置、密码、额度与违规记录，且无法恢复。确定继续？")
            .setPositiveButton("清除") { _, _ ->
                graph.settingsStore.reset()
                graph.quotaStore.reset(java.time.LocalDate.now())
                graph.budget.reset(java.time.Instant.now())
                graph.guardStore.clearTamperEvents()
                graph.guardStore.setDismissedWindowKey(null)
                graph.guardStore.clearAnchor()
                graph.ai.clearCache()
                toast("已清除全部本地数据")
                render()
            }
            .setNegativeButton("取消", null)
            .show()
    }

    /* ═════════════ 渲染 ═════════════ */

    private fun render() {
        val settings = graph.settingsStore.value
        updatingUi = true

        binding.switchPlanEnabled.isChecked = settings.plan.enabled

        val weekday = settings.plan.windowOf(DayType.WEEKDAY) ?: PlanWindow("23:00", "07:00")
        val weekend = settings.plan.windowOf(DayType.WEEKEND) ?: PlanWindow("23:00", "07:00")
        binding.btnWeekdayWindow.text = "工作日时段　" + weekday.start + " - " + weekday.end
        binding.btnWeekendWindow.text = "周末时段　" + weekend.start + " - " + weekend.end
        binding.btnWarnMinutes.text = "提前提醒　" + settings.plan.warnMinutes + " 分钟"

        binding.planHintText.text = buildString {
            append("调休上班日（如 2026-09-20、2026-10-10）按工作日时段熄灯。")
            append("\n节假日数据覆盖：" + Holidays.coveredYears().joinToString("、") + " 年。")
        }

        binding.btnWhitelistTotal.text = "总可用时长　" + settings.whitelist.totalMinutes + " 分钟"
        val usage = graph.budget.snapshot(java.time.Instant.now())
        binding.whitelistUsageText.text = "本周期已用 " + TimeUtils.formatDurationCN(usage.usedMs) +
            "，剩余 " + TimeUtils.formatDurationCN(usage.remainingMs)
        renderWhitelist()

        binding.btnAudioPreset.text = "音色　" + NoiseSynth.presetOf(settings.audio.preset).label
        val durationLabel = NoiseSynth.DURATION_OPTIONS
            .firstOrNull { it.first == settings.audio.durationMinutes }?.second ?: "30 分钟"
        binding.btnAudioDuration.text = "播放时长　" + durationLabel
        val volumePercent = (settings.audio.volume * 100).toInt().coerceIn(0, 100)
        binding.seekAudioVolume.progress = volumePercent
        binding.audioVolumeLabel.text = "音量 " + volumePercent + "%"

        binding.switchAiEnabled.isChecked = settings.ai.enabled
        if (binding.inputAiBaseUrl.text.isNullOrEmpty()) binding.inputAiBaseUrl.setText(settings.ai.baseUrl)
        if (binding.inputAiModel.text.isNullOrEmpty()) binding.inputAiModel.setText(settings.ai.model)
        binding.aiStatusText.text = if (settings.ai.apiKey.isEmpty()) {
            "未配置 API Key：将使用内置本地文案库，功能完整。"
        } else {
            "已配置 API Key（仅存于本机），缓存 " + graph.ai.cacheSize() + " 条文案。"
        }

        val tamper = graph.guardStore.tamperEvents()
        binding.tamperText.text = if (tamper.isEmpty()) {
            "未检测到系统时间被修改。"
        } else {
            "检测到 " + tamper.size + " 次系统时间修改，最近一次：" +
                TimeUtils.formatClock(TimeUtils.localDateTime(java.time.Instant.ofEpochMilli(tamper.last().atMs))) +
                "（" + (if (tamper.last().direction == "forward") "向前" else "向后") + "，偏差 " +
                (tamper.last().driftMs / 1000) + " 秒）"
        }

        binding.aboutText.text = buildString {
            append("文案与数据溯源：\n")
            append("· 健康类结论共 " + CopyLibrary.HAZARD_COUNT + " 条，每条都标注了原始文献来源，可在熄灯界面查看。\n")
            append("· 节假日数据来源：" + Holidays.SOURCE_TITLE + "（" + Holidays.SOURCE_DOCUMENT_NUMBER + "，" + Holidays.SOURCE_ISSUED_AT + "）。\n")
            append("· 数据覆盖区间：" + Holidays.SOURCE_COVERAGE + "；未覆盖年份按普通日期处理，不会生成错误的节日文案。\n")
            append("· 助眠音频由 AudioTrack 实时合成，不含任何音频素材文件。\n")
            append("· 本应用不采集、不上传任何隐私数据；API Key 由用户本机保管。")
        }

        updatingUi = false
    }

    private fun renderWhitelist() {
        val container = binding.whitelistContainer
        container.removeAllViews()
        for (app in graph.settingsStore.value.whitelist.apps) {
            val row = ItemWhitelistAppBinding.inflate(layoutInflater, container, false)
            row.appName.text = app.name
            row.appMeta.text = when {
                app.system -> app.description.ifBlank { "系统应用，不占时长" }
                app.countsAgainstQuota -> app.packageName.ifBlank { "自定义应用" }
                else -> app.description.ifBlank { "不占时长" }
            }
            if (app.removable) {
                row.btnRemove.isEnabled = true
                row.btnRemove.text = "移除"
                row.btnRemove.setOnClickListener { removeWhitelistApp(app.id) }
            } else {
                row.btnRemove.isEnabled = false
                row.btnRemove.text = "固定"
                row.btnRemove.visibility = View.VISIBLE
            }
            container.addView(row.root)
        }
    }

    /** 设置变更后：让前台服务立刻重新排闹钟并按新计划接管 */
    private fun afterChange() {
        AlarmScheduler.schedule(this, graph.settingsStore.value.plan)
        graph.controller.startLockService()
    }
}
