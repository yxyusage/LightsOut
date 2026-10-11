package com.xideng.sleep.ui

import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.WindowManager
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.xideng.sleep.XidengApp
import com.xideng.sleep.core.Phase
import com.xideng.sleep.core.TimeUtils
import com.xideng.sleep.databinding.ActivityWarningBinding
import java.lang.ref.WeakReference

/**
 * 熄灯早睡 · 提前预告弹窗（PRD 2.1.2）
 *
 * 全屏半透明、**不可关闭**，只显示倒计时；倒计时结束后由
 * [com.xideng.sleep.lock.LockController] 自动切换到 [BlackoutActivity]。
 *
 * 额外支持"预览模式"：从主界面点进来时给 30 秒倒计时，
 * 让人不必真的等到 23:00 就能看到这个弹窗长什么样。
 */
class WarningActivity : AppCompatActivity() {

    private lateinit var binding: ActivityWarningBinding
    private lateinit var graph: com.xideng.sleep.AppGraph
    private val handler = Handler(Looper.getMainLooper())

    @Volatile private var resumed = false
    private var previewUntilMs = 0L

    private val ticker = object : Runnable {
        override fun run() {
            if (!resumed) return
            onTick()
            handler.postDelayed(this, TICK_MS)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        graph = XidengApp.graphOf(this)

        @Suppress("DEPRECATION")
        window.addFlags(
            WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
                WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON,
        )
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        }
        WindowCompat.setDecorFitsSystemWindows(window, false)
        val controller = WindowInsetsControllerCompat(window, window.decorView)
        controller.hide(WindowInsetsCompat.Type.systemBars())
        controller.systemBarsBehavior =
            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE

        binding = ActivityWarningBinding.inflate(layoutInflater)
        setContentView(binding.root)

        if (intent?.getBooleanExtra(EXTRA_PREVIEW, false) == true) {
            previewUntilMs = System.currentTimeMillis() + PREVIEW_DURATION_MS
        }

        instance = WeakReference(this)
    }

    override fun onResume() {
        super.onResume()
        resumed = true
        onTick()
        handler.removeCallbacks(ticker)
        handler.post(ticker)
    }

    override fun onPause() {
        resumed = false
        handler.removeCallbacks(ticker)
        super.onPause()
    }

    override fun onDestroy() {
        handler.removeCallbacks(ticker)
        if (instance?.get() === this) instance = null
        super.onDestroy()
    }

    private fun onTick() {
        val snapshot = graph.engine.snapshot()

        if (previewUntilMs > 0L) {
            val remaining = previewUntilMs - System.currentTimeMillis()
            if (remaining <= 0L) {
                previewUntilMs = 0L
                requestDismiss()
                return
            }
            binding.countdownText.text = TimeUtils.formatCountdownCN(remaining)
            binding.warnDetailText.text = "预览：熄灯界面会在倒计时结束后接管屏幕"
            return
        }

        if (snapshot.phase != Phase.WARNING) {
            // 要么已经进入熄灯（交给 BlackoutActivity），要么计划被关掉了
            requestDismiss()
            return
        }

        binding.countdownText.text = TimeUtils.formatCountdownCN(snapshot.remainingMs)
        val start = snapshot.window?.start
        binding.warnDetailText.text = if (start != null) {
            "熄灯将于 " + TimeUtils.formatClock(TimeUtils.localDateTime(start)) + " 开始"
        } else {
            ""
        }
    }

    private fun requestDismiss() {
        handler.removeCallbacks(ticker)
        if (!resumed || isFinishing) {
            finish()
            return
        }
        finish()
    }

    companion object {
        const val EXTRA_PREVIEW = "preview"
        private const val TICK_MS = 250L
        private const val PREVIEW_DURATION_MS = 30_000L

        @Volatile
        private var instance: WeakReference<WarningActivity>? = null

        fun isVisible(): Boolean {
            val activity = instance?.get() ?: return false
            return activity.resumed && !activity.isFinishing
        }

        fun launch(context: Context) {
            try {
                context.startActivity(
                    Intent(context, WarningActivity::class.java)
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
                )
            } catch (error: Exception) {
                // 后台启动被拒时由带全屏意图的通知兜底（见 NotificationHelper）
            }
        }

        fun launchPreview(context: Context) {
            context.startActivity(
                Intent(context, WarningActivity::class.java)
                    .putExtra(EXTRA_PREVIEW, true)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
        }

        fun requestDismiss() {
            instance?.get()?.requestDismiss()
        }
    }
}
