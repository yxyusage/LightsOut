package com.xideng.sleep.audio

import java.util.Random
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin

/**
 * 熄灯早睡 · 助眠白噪音合成（PRD 2.3）
 *
 * 五类音色全部用 [android.media.AudioTrack] **实时合成**，不加载任何音频文件。三个好处：
 *  1. 零版权风险 —— 赛事要求参赛素材必须享有合法权利，合成音没有这个问题；
 *  2. 零体积 —— 安装包不背几百 KB 的 mp3；
 *  3. 可无限循环不露接缝 —— 噪声是逐样本生成的，不像采样音频有循环点。
 *
 * 噪声算法移植自 `packages/core/src/audio.js` 的 `generateNoiseSamples`，
 * 滤波器为标准的 RBJ Audio EQ Cookbook 双二阶（biquad）。
 */
object NoiseSynth {

    const val SAMPLE_RATE = 44_100
    const val BLOCK_SIZE = 2_048

    data class Preset(val id: String, val label: String, val description: String)

    val PRESETS: List<Preset> = listOf(
        Preset("rain", "雨声", "绵密稳定，适合盖住环境杂音"),
        Preset("stream", "溪流声", "明亮流动，帮助放松注意力"),
        Preset("waves", "海浪声", "缓慢起伏，接近呼吸的节奏"),
        Preset("campfire", "篝火声", "低频温暖，夹着细碎爆裂声"),
        Preset("white", "纯白噪音", "最中性的遮蔽音，不引导情绪"),
    )

    /** PRD 2.3：可选 15 / 30 / 60 分钟，或持续播放至熄灯结束（用 0 表示） */
    val DURATION_OPTIONS: List<Pair<Int, String>> = listOf(
        15 to "15 分钟",
        30 to "30 分钟",
        60 to "60 分钟",
        0 to "持续播放至熄灯结束",
    )

    fun isPreset(id: String?): Boolean = PRESETS.any { it.id == id }

    fun presetOf(id: String?): Preset = PRESETS.firstOrNull { it.id == id } ?: PRESETS[0]

    fun create(presetId: String?, seed: Long = System.nanoTime()): SynthSession =
        SynthSession(presetOf(presetId).id, Random(seed))

    /** RBJ Audio EQ Cookbook 双二阶滤波器 */
    class Biquad {

        private enum class Kind { LOWPASS, HIGHPASS, BANDPASS }

        private var b0 = 1.0
        private var b1 = 0.0
        private var b2 = 0.0
        private var a1 = 0.0
        private var a2 = 0.0

        private var x1 = 0.0
        private var x2 = 0.0
        private var y1 = 0.0
        private var y2 = 0.0

        fun setLowpass(freq: Double, q: Double = 0.7071) = configure(freq, q, Kind.LOWPASS)

        fun setHighpass(freq: Double, q: Double = 0.7071) = configure(freq, q, Kind.HIGHPASS)

        fun setBandpass(freq: Double, q: Double = 1.0) = configure(freq, q, Kind.BANDPASS)

        private fun configure(freq: Double, q: Double, kind: Kind) {
            val f = freq.coerceIn(20.0, SAMPLE_RATE / 2.0 - 200.0)
            val w0 = 2.0 * PI * f / SAMPLE_RATE
            val cosW0 = cos(w0)
            val sinW0 = sin(w0)
            val alpha = sinW0 / (2.0 * maxOf(q, 0.05))

            val a0: Double
            when (kind) {
                Kind.LOWPASS -> {
                    b0 = (1.0 - cosW0) / 2.0
                    b1 = 1.0 - cosW0
                    b2 = b0
                    a0 = 1.0 + alpha
                    a1 = -2.0 * cosW0
                    a2 = 1.0 - alpha
                }
                Kind.HIGHPASS -> {
                    b0 = (1.0 + cosW0) / 2.0
                    b1 = -(1.0 + cosW0)
                    b2 = b0
                    a0 = 1.0 + alpha
                    a1 = -2.0 * cosW0
                    a2 = 1.0 - alpha
                }
                Kind.BANDPASS -> {
                    b0 = alpha
                    b1 = 0.0
                    b2 = -alpha
                    a0 = 1.0 + alpha
                    a1 = -2.0 * cosW0
                    a2 = 1.0 - alpha
                }
            }

            b0 /= a0
            b1 /= a0
            b2 /= a0
            a1 /= a0
            a2 /= a0
        }

        fun process(input: Double): Double {
            val output = b0 * input + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
            x2 = x1
            x1 = input
            y2 = y1
            y1 = output
            return output
        }
    }

    /**
     * 一次播放会话。系数只在每个数据块开始时更新一次
     * （块长 2048 样本 ≈ 46ms，对 0.05 ~ 0.4Hz 的 LFO 完全够用）。
     */
    class SynthSession(private val presetId: String, private val random: Random) {

        private var elapsedSeconds = 0.0
        private var brownLast = 0.0

        private val filterA = Biquad()
        private val filterB = Biquad()
        private val crackleFilter = Biquad()

        private var crackleCountdown = (0.2 * SAMPLE_RATE).toInt()
        private var crackleRemaining = 0
        private var crackleEnvelope = 0.0
        private var crackleDecay = 0.0

        fun render(out: FloatArray, frames: Int, volume: Double) {
            val t = elapsedSeconds
            var gain = 1.0
            var withCrackle = false

            when (presetId) {
                "white" -> gain = 0.28

                // 雨声：白噪声 → 高通 900Hz + 低通 7kHz，加 0.15Hz 缓慢起伏模拟雨势变化
                "rain" -> {
                    filterA.setHighpass(900.0)
                    filterB.setLowpass(7000.0)
                    gain = 0.22 * (1.0 + 0.05 * sin(2.0 * PI * 0.15 * t))
                }

                // 溪流声：白噪声 → 高通 500Hz + 带通 1.8kHz，0.4Hz 轻微调制中心频率
                "stream" -> {
                    filterA.setHighpass(500.0)
                    filterB.setBandpass(1800.0 + 400.0 * sin(2.0 * PI * 0.4 * t), 0.6)
                    gain = 0.24
                }

                // 海浪声：布朗噪声 → 低通 700Hz，0.08Hz 调制音量、0.05Hz 扫描截止频率
                "waves" -> {
                    filterA.setLowpass(700.0 + 250.0 * sin(2.0 * PI * 0.05 * t))
                    gain = 0.30 * (1.0 + 0.22 * sin(2.0 * PI * 0.08 * t))
                }

                // 篝火声：布朗噪声 → 低通 500Hz 打底，叠加随机高频爆裂脉冲
                "campfire" -> {
                    filterA.setLowpass(500.0)
                    gain = 0.26
                    withCrackle = true
                }
            }

            val dt = 1.0 / SAMPLE_RATE
            for (index in 0 until frames) {
                val white = random.nextDouble() * 2.0 - 1.0

                var sample = if (presetId == "white" || presetId == "rain" || presetId == "stream") {
                    white
                } else {
                    brown(white)
                }

                when (presetId) {
                    "rain" -> sample = filterB.process(filterA.process(sample))
                    "stream" -> sample = filterB.process(filterA.process(sample))
                    "waves" -> sample = filterA.process(sample)
                    "campfire" -> sample = filterA.process(sample)
                }

                if (withCrackle) sample += renderCrackle(white)

                out[index] = (sample * gain * volume).coerceIn(-1.0, 1.0).toFloat()
            }

            elapsedSeconds = t + frames * dt
        }

        /** 布朗噪声：对白噪声做泄漏积分，能量集中在低频，听感接近远处的水流与风声 */
        private fun brown(white: Double): Double {
            brownLast = (brownLast + 0.02 * white) / 1.02
            return brownLast * 3.5
        }

        /** 真实的篝火是不规则的，用随机间隔比等间隔更耐听 */
        private fun renderCrackle(white: Double): Double {
            if (crackleRemaining <= 0) {
                crackleCountdown -= 1
                if (crackleCountdown <= 0) {
                    val burstSamples = (0.06 * SAMPLE_RATE)
                    crackleCountdown = (0.12 * SAMPLE_RATE + random.nextDouble() * 0.9 * SAMPLE_RATE).toInt()
                    crackleRemaining = burstSamples.toInt()
                    crackleEnvelope = 0.06 + random.nextDouble() * 0.10
                    crackleDecay = 1.0 - 1.0 / burstSamples
                    crackleFilter.setBandpass(1500.0 + random.nextDouble() * 2500.0, 1.2)
                }
                return 0.0
            }

            crackleRemaining -= 1
            val value = crackleFilter.process(white) * crackleEnvelope
            crackleEnvelope *= crackleDecay
            return value
        }
    }
}
