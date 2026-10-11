package com.xideng.sleep.ui

import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import com.xideng.sleep.XidengApp
import com.xideng.sleep.core.TimeUtils
import com.xideng.sleep.databinding.ActivityEmergencyBinding
import java.time.Instant

/**
 * 熄灯早睡 · 紧急解除（PRD 2.2.5）
 *
 * 连续点击屏幕 5 次才能到达这里，然后需要输入预设密码。
 * 校验顺序在 [com.xideng.sleep.core.LockEngine.emergencyUnlock] 里刻意设计为
 * 「先密码、后额度」——密码错误不应该消耗用户宝贵的解除次数。
 *
 * 每解除一次消耗 1 次每周额度；额度为 0 时入口不可用。
 */
class EmergencyActivity : AppCompatActivity() {

    private lateinit var binding: ActivityEmergencyBinding
    private lateinit var graph: com.xideng.sleep.AppGraph

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        graph = XidengApp.graphOf(this)

        binding = ActivityEmergencyBinding.inflate(layoutInflater)
        setContentView(binding.root)

        binding.btnCancel.setOnClickListener { finish() }
        binding.btnConfirm.setOnClickListener { submit() }
    }

    override fun onResume() {
        super.onResume()
        render()
    }

    private fun render() {
        val snapshot = graph.engine.snapshot()
        val configured = snapshot.settings.emergency.passwordHash.isNotEmpty()
        binding.quotaText.text =
            "本周剩余解除次数：" + snapshot.quota.remaining + " / " + snapshot.quota.total

        binding.btnConfirm.isEnabled = configured && snapshot.quota.remaining > 0
        if (!configured) {
            showError("尚未设置紧急解除密码，请先到「设置 → 安全与额度」里设置")
        } else if (snapshot.quota.remaining <= 0) {
            showError("本周解除额度已用完，只能等熄灯时段自然结束")
        } else {
            binding.errorText.visibility = android.view.View.GONE
        }
    }

    private fun submit() {
        val password = binding.passwordInput.text.toString()
        if (password.isEmpty()) {
            showError("请输入密码")
            return
        }

        val result = graph.engine.emergencyUnlock(password)
        if (result.ok) {
            graph.controller.onEmergencyDismissed()
            toast("已解除，本周还剩 " + result.remaining + " 次")
            finish()
            return
        }

        val message = when (result.reason) {
            "no-password" -> "尚未设置紧急解除密码"
            "not-active" -> "当前不在熄灯时段内，无需解除"
            "bad-password" -> "密码不正确"
            "quota-exhausted" -> "本周解除额度已用完"
            else -> "解除失败"
        }
        showError(message)
        binding.passwordInput.setText("")
    }

    private fun showError(message: String) {
        binding.errorText.text = message
        binding.errorText.visibility = android.view.View.VISIBLE
    }
}
