package com.xideng.sleep.core

import java.time.Instant

/**
 * 熄灯早睡 · 状态引擎
 *
 * 把"计划 + 场景 + 文案 + 额度 + 紧急解除 + 防篡改锚点"组合成一个可被 UI 直接消费的快照。
 * 引擎自身**不持有定时器、不读系统时间、不操作 UI**，当前时间由调用方注入，
 * 因此可以在单元测试里任意"穿越时间"验证。
 *
 * 与 `packages/core/src/engine.js` 对应；防篡改锚点那部分对应
 * `apps/web/src/app.js` 的 `effectivePhase()` 与 `ui.freezeUntil`。
 */

data class EngineSnapshot(
    val at: Instant,
    val settings: Settings,
    val scene: SceneInfo,
    val quota: QuotaStore.Snapshot,
    val phase: Phase,
    val window: SleepWindow?,
    val windowStartKey: String?,
    val windowEnd: Instant?,
    val remainingMs: Long,
    val warnMs: Long,
    val dismissed: Boolean,
    /** 剩余时长来自锚点而非墙上时钟，说明检测到时间被改动 */
    val anchored: Boolean,
    val copy: CopyEntry,
    val copyIntervalMs: Long,
    val copyTotal: Int,
    val whitelist: WhitelistBudget.Snapshot,
)

data class EmergencyOutcome(val ok: Boolean, val remaining: Int, val reason: String?)

class LockEngine(
    val settingsStore: SettingsStore,
    val quotaStore: QuotaStore,
    val budget: WhitelistBudget,
    val guardStore: GuardStore,
    private val nowProvider: () -> Instant = { Instant.now() },
) {

    private var playlist: List<CopyEntry>? = null
    private var playlistKey: String? = null
    private var rotator: Rotator? = null

    /** AI 生成的文案，优先级高于本地轮播；只作为"开场第一句" */
    private var aiText: String? = null

    fun now(): Instant = nowProvider()

    private fun ensurePlaylist(scene: SceneInfo) {
        val key = scene.dateKey + "|" + scene.scene
        if (key == playlistKey && rotator != null) return
        val configuredMs = settingsStore.value.blackout.copyIntervalSec.toLong() * 1000L
        val interval = if (configuredMs > 0L) configuredMs else Constants.COPY_ROTATE_MS
        val entries = CopyLibrary.buildPlaylist(scene)
        playlist = entries
        rotator = Rotator(entries, interval)
        playlistKey = key
    }

    /**
     * 当前状态快照。UI 每一帧都调用它。
     *
     * 防篡改逻辑：进入熄灯时由控制层落锚（[GuardStore.armAnchor]），
     * 之后只要锚点还有剩余，相位就锁定为 ACTIVE——**无论用户把系统时间往哪边拨**。
     * 这正是 PRD 三「不重置剩余时长」的实现方式。
     */
    fun snapshot(): EngineSnapshot {
        val settings = settingsStore.value
        val at = now()
        val atDate = TimeUtils.localDate(at)

        val base = Schedule.phaseAt(
            plan = settings.plan,
            now = at,
            warnMinutes = settings.plan.warnMinutes,
            dismissedWindowKey = guardStore.getDismissedWindowKey(),
        )

        val anchoredRemaining = if (settings.guard.detectClockTamper) guardStore.anchorRemainingMs() else null
        var phase = base.phase
        var remainingMs = base.remainingMs
        var anchored = false

        if (!base.dismissed && anchoredRemaining != null) {
            phase = Phase.ACTIVE
            remainingMs = anchoredRemaining
            anchored = base.phase != Phase.ACTIVE
        }

        val scene = SceneDetector.detect(TimeUtils.localDateTime(at))
        ensurePlaylist(scene)

        val effectiveRotator = rotator
        val current = effectiveRotator?.current()
            ?: CopyEntry("fallback", "comfort", "灯已经关了。现在，只需要闭上眼睛。")

        val windowStartKey = base.window?.startKey ?: guardStore.getAnchor()?.startKey
        val windowEnd = base.window?.end ?: if (phase == Phase.ACTIVE) at.plusMillis(remainingMs) else null

        val currentAiText = aiText

        return EngineSnapshot(
            at = at,
            settings = settings,
            scene = scene,
            quota = quotaStore.snapshot(atDate),
            phase = phase,
            window = base.window,
            windowStartKey = windowStartKey,
            windowEnd = windowEnd,
            remainingMs = remainingMs,
            warnMs = base.warnMs,
            dismissed = base.dismissed,
            anchored = anchored,
            copy = if (currentAiText != null) CopyEntry("ai", "ai", currentAiText, "ai") else current,
            copyIntervalMs = effectiveRotator?.intervalMs ?: Constants.COPY_ROTATE_MS,
            copyTotal = effectiveRotator?.size ?: 0,
            whitelist = budget.snapshot(at),
        )
    }

    /** 推进到下一句文案（由 UI 的定时器调用） */
    fun rotateCopy(): CopyEntry {
        val currentRotator = rotator ?: run {
            ensurePlaylist(SceneDetector.detect(TimeUtils.localDateTime(now())))
            rotator
        } ?: return CopyEntry("fallback", "comfort", "灯已经关了。")
        return currentRotator.next()
    }

    /** 跳回播放列表开头（重新进入熄灯模式时调用，保证每次从第一句开始） */
    fun resetCopy() {
        if (rotator == null) ensurePlaylist(SceneDetector.detect(TimeUtils.localDateTime(now())))
        rotator?.reset()
    }

    /** 注入 AI 文案；传 null 恢复本地轮播 */
    fun setAiText(text: String?) {
        aiText = if (!text.isNullOrBlank()) text.trim() else null
    }

    val aiTextValue: String? get() = aiText

    val playlistValue: List<CopyEntry>? get() = playlist

    /**
     * 紧急解除（PRD 2.2.5）。
     * 校验顺序刻意设计为「先密码、后额度」——密码错误不应消耗用户宝贵的解除次数。
     */
    fun emergencyUnlock(password: String): EmergencyOutcome {
        val settings = settingsStore.value

        if (settings.emergency.passwordHash.isEmpty()) {
            return EmergencyOutcome(false, 0, "no-password")
        }

        val at = now()
        val atDate = TimeUtils.localDate(at)

        // 解除必须发生在"真正处于熄灯中"的时候，包括被锚点锁定的情况
        val snapshot = snapshot()
        if (snapshot.phase != Phase.ACTIVE) {
            return EmergencyOutcome(false, 0, "not-active")
        }

        if (!PasswordHasher.verify(password, settings.emergency.passwordHash)) {
            return EmergencyOutcome(false, 0, "bad-password")
        }

        val consumed = quotaStore.consume(atDate)
        if (!consumed.ok) {
            return EmergencyOutcome(false, 0, "quota-exhausted")
        }

        // 只解除"当前这一次"时段，次日计划照常生效
        guardStore.setDismissedWindowKey(snapshot.windowStartKey)
        // 解除后必须清掉锚点，否则锚点会把用户重新锁回熄灯
        guardStore.clearAnchor()
        return EmergencyOutcome(true, consumed.remaining, null)
    }

    /** 重新武装（跨时段或用户手动恢复计划时调用） */
    fun rearm() {
        guardStore.setDismissedWindowKey(null)
        guardStore.clearAnchor()
    }

    val dismissed: String? get() = guardStore.getDismissedWindowKey()
}
