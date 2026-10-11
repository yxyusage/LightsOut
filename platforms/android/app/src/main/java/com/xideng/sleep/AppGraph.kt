package com.xideng.sleep

import android.content.Context
import android.os.SystemClock
import com.xideng.sleep.core.AiClient
import com.xideng.sleep.core.Constants
import com.xideng.sleep.core.GuardStore
import com.xideng.sleep.core.KeyValueStore
import com.xideng.sleep.core.LockEngine
import com.xideng.sleep.core.PlanSettings
import com.xideng.sleep.core.QuotaStore
import com.xideng.sleep.core.Schedule
import com.xideng.sleep.core.Settings
import com.xideng.sleep.core.SettingsStore
import com.xideng.sleep.core.TimeUtils
import com.xideng.sleep.core.WhitelistBudget
import com.xideng.sleep.data.SharedPrefsStore
import com.xideng.sleep.lock.ClockGuard
import com.xideng.sleep.lock.LockController
import java.time.Instant
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * 熄灯早睡 · 依赖装配
 *
 * 把 core 里的纯逻辑对象与 Android 的存储、时钟、上下文接起来。
 * 所有跨组件共享的状态都从这里取，避免每个 Activity 各读一份导致不一致。
 */
class AppGraph(context: Context) {

    private val appContext: Context = context.applicationContext

    val storage: KeyValueStore = SharedPrefsStore(appContext)

    val settingsStore: SettingsStore = SettingsStore(storage)

    val quotaStore: QuotaStore = QuotaStore(storage)

    /**
     * 单调时钟注入 [SystemClock.elapsedRealtime]：
     * 它包含深睡时间、且不受用户修改系统时间影响，正是防篡改锚点需要的基准。
     */
    val guardStore: GuardStore = GuardStore(
        storage = storage,
        monotonicClock = { SystemClock.elapsedRealtime() },
    )

    val budget: WhitelistBudget = WhitelistBudget(
        storage = storage,
        totalMinutesProvider = { settingsStore.value.whitelist.totalMinutes },
        periodKeyProvider = { at -> periodKeyOf(settingsStore.value.plan, at) },
    )

    val engine: LockEngine = LockEngine(
        settingsStore = settingsStore,
        quotaStore = quotaStore,
        budget = budget,
        guardStore = guardStore,
    )

    val ai: AiClient = AiClient(
        configProvider = { settingsStore.value.ai },
        storage = storage,
        cacheKey = Constants.KEY_AI_CACHE,
    )

    val clockGuard: ClockGuard = ClockGuard()

    /** 白名单应用本次会话（内存态；重启后自然结束，避免把离线时间也算进额度） */
    val whitelistSession: WhitelistSession = WhitelistSession()

    /** AI 请求是阻塞式的，统一丢到单线程池，绝不占用主线程 */
    val ioExecutor: ExecutorService = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "xideng-io").apply { isDaemon = true }
    }

    val controller: LockController = LockController(appContext, this)

    init {
        quotaStore.setTotal(settingsStore.value.emergency.quotaTotal)
        // 设置变化时同步额度上限（用户可能在设置页调整）
        settingsStore.subscribe { settings: Settings -> quotaStore.setTotal(settings.emergency.quotaTotal) }
    }

    companion object {
        /**
         * 白名单计费周期取"当前熄灯时段的开始日"而非日历日。
         *
         * 这样 23:00 → 次日 07:00 的一次熄灯共用一个额度池，跨过午夜不会白送一份新额度。
         * 理由与取舍见 `packages/core/src/whitelist.js` 顶部注释。
         */
        fun periodKeyOf(plan: PlanSettings, at: Instant): String {
            val window = Schedule.activeWindowAt(plan, at)
            return if (window != null) {
                "window:" + window.startKey
            } else {
                "day:" + TimeUtils.dateKey(TimeUtils.localDate(at))
            }
        }
    }
}

/** 白名单应用的本次使用会话（PRD 2.2.3：使用时长实时扣减） */
class WhitelistSession {
    @Volatile var appId: String? = null
    @Volatile var appName: String? = null
    @Volatile var countsAgainstQuota: Boolean = false
    @Volatile var startedAt: Long = 0L
    @Volatile var lastChargedAt: Long = 0L

    fun begin(appId: String, appName: String, countsAgainstQuota: Boolean) {
        this.appId = appId
        this.appName = appName
        this.countsAgainstQuota = countsAgainstQuota
        val now = System.currentTimeMillis()
        this.startedAt = now
        this.lastChargedAt = now
    }

    fun clear() {
        appId = null
        appName = null
        countsAgainstQuota = false
        startedAt = 0L
        lastChargedAt = 0L
    }

    val active: Boolean get() = appId != null
}
