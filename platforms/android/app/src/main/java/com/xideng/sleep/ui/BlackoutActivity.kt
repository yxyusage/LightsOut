package com.xideng.sleep.ui

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.View
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.xideng.sleep.AppGraph
import com.xideng.sleep.XidengApp
import com.xideng.sleep.audio.NoiseSynth
import com.xideng.sleep.core.BlackoutSettings
import com.xideng.sleep.core.Constants
import com.xideng.sleep.core.CopyLibrary
import com.xideng.sleep.core.EngineSnapshot
import com.xideng.sleep.core.Phase
import com.xideng.sleep.core.TimeUtils
import com.xideng.sleep.core.WhitelistApp
import com.xideng.sleep.databinding.ActivityBlackoutBinding
import com.xideng.sleep.service.AudioService
import com.xideng.sleep.util.TapCounter
import org.json.JSONObject
import java.lang.ref.WeakReference
import java.time.Instant

/**
 * 熄灯早睡 · 黑屏主界面（PRD 2.2.2）
 *
 * 两种渲染方式：
 *  · **原生布局**（默认兜底，永远可用）：纯黑背景 + 低亮度白字，
 *    展示实时时间、距离熄灯结束的剩余时长、轮播文案，底部是白名单与助眠音乐入口；
 *  · **WebView**（`assets/web/blackout.html`，可通过设置切换）：与 Web/PWA 版视觉完全一致，
 *    状态由 [Bridge] 的 `getState()` 提供，因此两端的数字永远来自同一个引擎。
 *
 * 入场 / 退场动画按 PRD 4.3 实现：拉灯绳 → 灯泡由亮渐灭 → 屏幕同步渐暗，约 1.5 秒。
 */
class BlackoutActivity : AppCompatActivity() {

    private lateinit var binding: ActivityBlackoutBinding
    private lateinit var graph: AppGraph
    private val handler = Handler(Looper.getMainLooper())

    private val tapCounter = TapCounter(Constants.EMERGENCY_TAP_COUNT, Constants.EMERGENCY_TAP_WINDOW_MS)

    @Volatile private var resumed = false
    @Volatile private var exiting = false
    private var copyElapsedMs = 0L
    private var aiRequested = false
    private var entering = false

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

        applyWindowFlags()

        binding = ActivityBlackoutBinding.inflate(layoutInflater)
        setContentView(binding.root)
        binding.root.setBackgroundColor(Color.BLACK)

        // PRD 2.2.5：连续点击屏幕 5 次触发紧急解除入口（隐藏区域 = 整个屏幕）
        binding.blackoutRoot.setOnClickListener { onScreenTap() }

        binding.btnWhitelist.setOnClickListener { showWhitelistSheet() }
        binding.btnAudio.setOnClickListener { showAudioSheet() }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                // 熄灯时段内不允许用返回键退出（PRD 三）。这里刻意什么都不做。
                toast("熄灯时段内无法通过返回键退出")
            }
        })

        if (shouldUseWebView()) {
            setupWebView()
        } else {
            binding.webView.visibility = View.GONE
            binding.nativeContent.visibility = View.VISIBLE
        }

        instance = WeakReference(this)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        when (intent.action) {
            ACTION_DISMISS -> requestExit()
            ACTION_ENTER -> Unit
        }
    }

    override fun onResume() {
        super.onResume()
        resumed = true
        exiting = false
        // 用户从白名单应用回到熄灯界面：结算这一段使用时长（PRD 2.2.3）
        graph.controller.endWhitelistSession()
        tapCounter.reset()

        val snapshot = graph.engine.snapshot()
        copyElapsedMs = 0L
        aiRequested = false
        graph.engine.resetCopy()
        requestAiCopy(snapshot)

        render(snapshot)
        handler.removeCallbacks(ticker)
        handler.post(ticker)

        if (!entering && !snapshot.settings.blackout.let { false }) {
            entering = true
            playEnterAnimation()
        } else {
            binding.nativeContent.alpha = 1f
        }
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

    /* ───────────── 窗口与沉浸式全屏 ───────────── */

    private fun applyWindowFlags() {
        // ⚠️ 这里刻意**不**用 FLAG_TURN_SCREEN_ON / FLAG_SHOW_WHEN_LOCKED / FLAG_KEEP_SCREEN_ON。
        //
        // PRD 2.2.2 原本要求这三个标志，但真机上它们的效果是"用户锁屏后屏幕又被强行点亮、
        // 而且在锁屏之上也显示熄灯界面" —— 睡前想锁屏放下手机的人反而被屏幕一直照着，
        // 这与"把手机交还给睡眠"的产品目标正好相反。
        //
        // 现在的行为（用户明确要求）：
        //   · 息屏就让它息屏，熄灯界面在后台等着；
        //   · 解锁后自动回到熄灯界面，仍然逃不掉。
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            // 从 Android 8.1 起这两个方法取代对应的窗口标志，必须显式置 false；
            // 否则 Activity 仍可能继承 theme 里的行为。
            setShowWhenLocked(false)
            setTurnScreenOn(false)
        }

        WindowCompat.setDecorFitsSystemWindows(window, false)
        val controller = WindowInsetsControllerCompat(window, window.decorView)
        controller.hide(WindowInsetsCompat.Type.systemBars())
        controller.systemBarsBehavior =
            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
    }

    /* ───────────── 心跳 ───────────── */

    private fun onTick() {
        val snapshot = graph.engine.snapshot()
        if (snapshot.phase != Phase.ACTIVE) {
            requestExit()
            return
        }

        copyElapsedMs += TICK_MS
        if (copyElapsedMs >= snapshot.copyIntervalMs) {
            copyElapsedMs = 0L
            // AI 文案只作为"开场第一句"，展示一轮后交还给本地文案库
            if (graph.engine.aiTextValue != null) graph.engine.setAiText(null) else graph.engine.rotateCopy()
        }

        render(graph.engine.snapshot())
    }

    private fun render(snapshot: EngineSnapshot) {
        if (binding.webView.visibility == View.VISIBLE) return

        val local = TimeUtils.localDateTime(snapshot.at)
        binding.clockText.text = TimeUtils.formatClock(local, seconds = true)
        binding.remainingText.text = "距离本次熄灯结束 " + TimeUtils.formatDurationCN(snapshot.remainingMs)
        binding.sceneText.text = snapshot.scene.sceneLabel +
            if (snapshot.anchored) " · 已拦截时间修改" else ""

        binding.copyText.text = snapshot.copy.text
        val sourceLabel = snapshot.copy.source?.let { CopyLibrary.FACT_SOURCES[it]?.label }
        if (sourceLabel != null) {
            binding.copySourceText.text = "数据来源：" + sourceLabel
            binding.copySourceText.visibility = View.VISIBLE
        } else {
            binding.copySourceText.visibility = View.GONE
        }

        binding.whitelistStatusText.text =
            "白名单剩余 " + TimeUtils.formatDurationCN(snapshot.whitelist.remainingMs)

        binding.audioStatusText.text = if (AudioService.isPlaying) {
            "助眠音乐播放中 · " + NoiseSynth.presetOf(snapshot.settings.audio.preset).label
        } else {
            ""
        }
    }

    /**
     * 请求一次 AI 场景化文案（PRD 2.4）。
     *
     * 三条约束：
     *  1. 每次进入熄灯界面只请求一次（[aiRequested] 去重），避免反复打接口；
     *  2. [AiClient.generate] 是阻塞式的，必须丢到 [AppGraph.ioExecutor]，绝不占用主线程；
     *  3. 任何失败都静默退回本地文案库 —— 没配 Key、网络不通、接口报错，
     *     用户看到的依然是一句正常的文案，熄灯流程不受影响。
     */
    private fun requestAiCopy(snapshot: EngineSnapshot) {
        if (aiRequested) return
        if (!graph.ai.available) return
        aiRequested = true

        val scene = snapshot.scene
        graph.ioExecutor.execute {
            val result = graph.ai.generate(scene)
            if (!result.ok || result.text.isNullOrBlank()) return@execute
            handler.post {
                // 请求返回时用户可能已经退出熄灯界面了
                if (!resumed) return@post
                graph.engine.setAiText(result.text)
                render(graph.engine.snapshot())
            }
        }
    }

    /* ───────────── WebView ───────────── */

    private fun shouldUseWebView(): Boolean {
        val mode = graph.settingsStore.value.blackout.renderMode
        return when (mode) {
            BlackoutSettings.RENDER_NATIVE -> false
            BlackoutSettings.RENDER_WEBVIEW -> hasBlackoutAsset()
            else -> hasBlackoutAsset()
        }
    }

    private fun hasBlackoutAsset(): Boolean = try {
        assets.open(WEBVIEW_ASSET).use { true }
    } catch (error: Exception) {
        false
    }

    private fun setupWebView() {
        val webView = binding.webView
        binding.nativeContent.visibility = View.GONE
        webView.visibility = View.VISIBLE
        webView.setBackgroundColor(Color.BLACK)
        webView.isVerticalScrollBarEnabled = false
        webView.isHorizontalScrollBarEnabled = false

        @Suppress("SetJavaScriptEnabled")
        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = false
        webView.settings.allowFileAccess = true
        webView.settings.allowContentAccess = false

        webView.addJavascriptInterface(Bridge(), "XidengBridge")
        webView.webViewClient = object : WebViewClient() {
            override fun onReceivedError(
                view: WebView?,
                request: WebResourceRequest?,
                error: WebResourceError?,
            ) {
                // 资产缺失或加载失败：立刻退回原生布局，绝不让用户看到白屏
                handler.post { fallbackToNative() }
            }
        }
        webView.loadUrl("file:///android_asset/" + WEBVIEW_ASSET)
    }

    private fun fallbackToNative() {
        binding.webView.visibility = View.GONE
        binding.nativeContent.visibility = View.VISIBLE
        render(graph.engine.snapshot())
    }

    /** 供 assets/web/blackout.html 调用的桥。方法名与页面内的调用一一对应。 */
    inner class Bridge {

        @JavascriptInterface
        fun getState(): String = stateJson()

        @JavascriptInterface
        fun openWhitelist() {
            handler.post { showWhitelistSheet() }
        }

        @JavascriptInterface
        fun openAudio() {
            handler.post { showAudioSheet() }
        }

        @JavascriptInterface
        fun tap() {
            handler.post { onScreenTap() }
        }

        @JavascriptInterface
        fun ready() {
            handler.post { render(graph.engine.snapshot()) }
        }
    }

    private fun stateJson(): String {
        val snapshot = graph.engine.snapshot()
        val sourceLabel = snapshot.copy.source?.let { CopyLibrary.FACT_SOURCES[it]?.label } ?: ""
        val json = JSONObject()
        return try {
            json.put("phase", snapshot.phase.id)
            json.put("clock", TimeUtils.formatClock(TimeUtils.localDateTime(snapshot.at), seconds = true))
            json.put("remaining", TimeUtils.formatDurationCN(snapshot.remainingMs))
            json.put("copy", snapshot.copy.text)
            json.put("copySource", sourceLabel)
            json.put("scene", snapshot.scene.sceneLabel)
            json.put(
                "whitelistText",
                "白名单剩余 " + TimeUtils.formatDurationCN(snapshot.whitelist.remainingMs),
            )
            json.put(
                "audioText",
                if (AudioService.isPlaying) {
                    "助眠音乐：" + NoiseSynth.presetOf(snapshot.settings.audio.preset).label
                } else {
                    ""
                },
            )
            json.put("taps", tapCounter.progress)
            json.put("tapsRequired", Constants.EMERGENCY_TAP_COUNT)
            json.toString()
        } catch (error: Exception) {
            "{}"
        }
    }

    /* ───────────── 交互 ───────────── */

    private fun onScreenTap() {
        val result = tapCounter.tap()
        if (result.triggered) {
            openEmergency()
            return
        }
        // 隐藏入口：只有点到一半以上才给一点点提示，避免"完全发现不了"
        if (result.progress >= 3) {
            toast("再连续点击 " + result.remaining + " 次可紧急解除")
        }
    }

    private fun openEmergency() {
        tapCounter.reset()
        try {
            startActivity(Intent(this, EmergencyActivity::class.java))
        } catch (error: Exception) {
            toast("无法打开紧急解除界面")
        }
    }

    private fun showWhitelistSheet() {
        val snapshot = graph.engine.snapshot()
        val apps = snapshot.settings.whitelist.apps
        if (apps.isEmpty()) {
            toast("还没有配置白名单应用")
            return
        }
        val labels = apps.map { app ->
            if (app.countsAgainstQuota) app.name else app.name + "（不占时长）"
        }.toTypedArray()

        AlertDialog.Builder(this)
            .setTitle("白名单应用 · 剩余 " + TimeUtils.formatDurationCN(snapshot.whitelist.remainingMs))
            .setItems(labels) { _, which -> openWhitelistApp(apps[which]) }
            .setNegativeButton("关闭", null)
            .show()
    }

    private fun openWhitelistApp(app: WhitelistApp) {
        val snapshot = graph.engine.snapshot()
        if (app.countsAgainstQuota && snapshot.whitelist.exhausted) {
            toast("今晚的白名单时长已经用完了")
            return
        }

        val candidates = buildLaunchIntents(app)
        if (candidates.isEmpty()) {
            toast("这个应用没有可启动的入口，请在设置里重新添加")
            return
        }

        graph.controller.beginWhitelistSession(app.id, app.name, app.countsAgainstQuota)
        for (intent in candidates) {
            try {
                startActivity(intent)
                return
            } catch (error: Exception) {
                // 尝试下一个候选；全部失败时回滚计费
            }
        }
        graph.controller.endWhitelistSession()
        toast("无法打开：" + app.name)
    }

    private fun buildLaunchIntents(app: WhitelistApp): List<Intent> {
        val result = mutableListOf<Intent>()
        when {
            app.id == SYSTEM_PHONE_ID || app.uri.startsWith("tel") -> {
                result.add(Intent(Intent.ACTION_DIAL, Uri.parse("tel:")))
            }
            app.id == SYSTEM_SMS_ID || app.uri.startsWith("sms") -> {
                result.add(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_APP_MESSAGING))
                result.add(Intent(Intent.ACTION_VIEW, Uri.parse("sms:")))
            }
            app.packageName.isNotEmpty() -> {
                packageManager.getLaunchIntentForPackage(app.packageName)?.let { launch ->
                    result.add(launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                }
            }
        }
        return result
    }

    private fun showAudioSheet() {
        val presets = NoiseSynth.PRESETS
        val labels = presets.map { it.label + " · " + it.description }.toTypedArray()
        val playing = AudioService.isPlaying

        val builder = AlertDialog.Builder(this)
            .setTitle(if (playing) "助眠音乐（播放中）" else "助眠音乐")
            .setItems(labels) { _, which -> startAudio(presets[which].id) }
            .setNegativeButton("关闭", null)

        if (playing) {
            builder.setNeutralButton("停止播放") { _, _ ->
                AudioService.stop(this)
                binding.audioStatusText.text = ""
            }
        }
        builder.show()
    }

    private fun startAudio(presetId: String) {
        val settings = graph.settingsStore.value.audio
        graph.settingsStore.update { it.copy(audio = it.audio.copy(preset = presetId)) }
        AudioService.play(this, presetId, settings.durationMinutes)
        render(graph.engine.snapshot())
    }

    /* ───────────── 动画（PRD 4.3）───────────── */

    private fun playEnterAnimation() {
        val lamp = binding.lampLayer
        val bulb = binding.lampBulb
        val handle = binding.lampHandle
        val fade = binding.fadeOverlay

        lamp.visibility = View.VISIBLE
        fade.visibility = View.VISIBLE
        fade.alpha = 0f
        binding.nativeContent.alpha = 0f
        bulb.alpha = 1f
        handle.translationY = -dp(14f)

        // 1) 拉绳：把灯绳往下拽
        handle.animate().translationY(dp(26f)).setDuration(360L).start()
        // 2) 灯灭：灯泡由亮渐暗
        bulb.animate().alpha(0f).setStartDelay(360L).setDuration(700L).start()
        // 3) 屏幕同步渐暗至全黑
        fade.animate().alpha(1f).setStartDelay(900L).setDuration(600L).withEndAction {
            lamp.visibility = View.GONE
            fade.visibility = View.GONE
            binding.nativeContent.alpha = 1f
        }.start()
    }

    private fun playExitAnimation(onComplete: () -> Unit) {
        val lamp = binding.lampLayer
        val bulb = binding.lampBulb
        val handle = binding.lampHandle
        val fade = binding.fadeOverlay

        lamp.visibility = View.VISIBLE
        fade.visibility = View.VISIBLE
        fade.alpha = 1f
        bulb.alpha = 0f
        handle.translationY = dp(26f)

        handle.animate().translationY(-dp(14f)).setDuration(360L).start()
        bulb.animate().alpha(1f).setStartDelay(360L).setDuration(700L).start()
        fade.animate().alpha(0f).setStartDelay(900L).setDuration(600L).withEndAction {
            lamp.visibility = View.GONE
            fade.visibility = View.GONE
            onComplete()
        }.start()
    }

    /* ───────────── 退出 ───────────── */

    /** 由 [com.xideng.sleep.lock.LockController] 调用：退出熄灯模式并播退场动画 */
    fun requestExit() {
        runOnUiThread {
            if (exiting) return@runOnUiThread
            exiting = true
            handler.removeCallbacks(ticker)
            if (!resumed || isFinishing) {
                finish()
                return@runOnUiThread
            }
            playExitAnimation {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                    finishAndRemoveTask()
                } else {
                    finish()
                }
            }
        }
    }

    private fun dp(value: Float): Float = value * resources.displayMetrics.density

    companion object {
        const val ACTION_ENTER = "com.xideng.sleep.action.BLACKOUT_ENTER"
        const val ACTION_DISMISS = "com.xideng.sleep.action.BLACKOUT_DISMISS"

        private const val WEBVIEW_ASSET = "web/blackout.html"
        private const val TICK_MS = 250L
        private const val SYSTEM_PHONE_ID = "sys-phone"
        private const val SYSTEM_SMS_ID = "sys-sms"

        @Volatile
        private var instance: WeakReference<BlackoutActivity>? = null

        fun isVisible(): Boolean {
            val activity = instance?.get() ?: return false
            return activity.resumed && !activity.isFinishing
        }

        /**
         * 是否已经"摆在那里"（已创建且未销毁），不要求处于 resumed。
         *
         * 与 [isVisible] 的区别很关键：息屏时 Activity 只会 paused，[isVisible] 变 false，
         * 但界面其实还在返回栈上。这时若再调用 [launch]，就会不断重启 Activity ——
         * 真机表现就是"画面一直在来回切"，配合原来的 FLAG_TURN_SCREEN_ON 还会把屏幕反复点亮。
         *
         * 熄灯判定要问的是"界面在不在"，而不是"现在亮不亮"。
         */
        fun isPresented(): Boolean {
            val activity = instance?.get() ?: return false
            return !activity.isFinishing
        }

        fun launch(context: Context) {
            try {
                context.startActivity(
                    Intent(context, BlackoutActivity::class.java)
                        .setAction(ACTION_ENTER)
                        .addFlags(
                            Intent.FLAG_ACTIVITY_NEW_TASK or
                                Intent.FLAG_ACTIVITY_SINGLE_TOP or
                                Intent.FLAG_ACTIVITY_REORDER_TO_FRONT,
                        ),
                )
            } catch (error: Exception) {
                // Android 10+ 的后台启动限制可能拒绝；此时只能依赖全屏意图通知
                // 与无障碍服务的 reassertBlackout() 两条兜底路径。
            }
        }

        fun requestDismiss() {
            instance?.get()?.requestExit()
        }
    }
}
