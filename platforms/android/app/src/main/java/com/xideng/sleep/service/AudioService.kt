package com.xideng.sleep.service

import android.app.Service
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import com.xideng.sleep.XidengApp
import com.xideng.sleep.audio.NoiseSynth
import com.xideng.sleep.core.Constants
import com.xideng.sleep.util.NotificationHelper

/**
 * 熄灯早睡 · 助眠音频（PRD 2.3）
 *
 * 前台服务 + [AudioTrack] 流式播放实时合成的白噪音。
 * 熄屏后因为它是前台服务，系统不会掐断播放；播放到设定时长自动停止。
 * 任何音频异常都被吞掉——音频永远不该影响熄灯流程。
 */
class AudioService : Service() {

    private val graph by lazy { XidengApp.graphOf(this) }
    private val handler = Handler(Looper.getMainLooper())

    @Volatile private var renderer: RenderThread? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        NotificationHelper.ensureChannels(this)
        startForeground(
            Constants.NOTIFICATION_ID_AUDIO,
            NotificationHelper.buildAudioNotification(this, "准备中…"),
        )
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                stopPlayback()
                stopSelf()
                return START_NOT_STICKY
            }
            else -> {
                val preset = intent?.getStringExtra(EXTRA_PRESET) ?: graph.settingsStore.value.audio.preset
                val durationMinutes = intent?.getIntExtra(
                    EXTRA_DURATION_MINUTES,
                    graph.settingsStore.value.audio.durationMinutes,
                ) ?: graph.settingsStore.value.audio.durationMinutes
                startPlayback(preset, durationMinutes)
            }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        stopPlayback()
        super.onDestroy()
    }

    private fun startPlayback(presetId: String, durationMinutes: Int) {
        stopPlayback()
        val preset = NoiseSynth.presetOf(presetId)
        val thread = RenderThread(preset.id, durationMinutes)
        renderer = thread
        isPlaying = true
        thread.start()

        val durationText = if (durationMinutes > 0) "$durationMinutes 分钟" else "持续播放至熄灯结束"
        NotificationHelper.post(
            this,
            Constants.NOTIFICATION_ID_AUDIO,
            NotificationHelper.buildAudioNotification(this, preset.label + " · " + durationText),
        )
    }

    private fun stopPlayback() {
        val thread = renderer
        renderer = null
        isPlaying = false
        thread?.shutdown()
    }

    private inner class RenderThread(
        private val presetId: String,
        private val durationMinutes: Int,
    ) : Thread("xideng-audio") {

        @Volatile private var running = true

        fun shutdown() {
            running = false
        }

        override fun run() {
            val minBuffer = AudioTrack.getMinBufferSize(
                NoiseSynth.SAMPLE_RATE,
                AudioFormat.CHANNEL_OUT_MONO,
                AudioFormat.ENCODING_PCM_FLOAT,
            )
            if (minBuffer <= 0) {
                finish()
                return
            }

            var track: AudioTrack? = null
            try {
                track = AudioTrack.Builder()
                    .setAudioAttributes(
                        AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_MEDIA)
                            .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                            .build(),
                    )
                    .setAudioFormat(
                        AudioFormat.Builder()
                            .setEncoding(AudioFormat.ENCODING_PCM_FLOAT)
                            .setSampleRate(NoiseSynth.SAMPLE_RATE)
                            .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                            .build(),
                    )
                    .setBufferSizeInBytes(minBuffer * 4)
                    .setTransferMode(AudioTrack.MODE_STREAM)
                    .build()

                track.play()

                val session = NoiseSynth.create(presetId)
                val buffer = FloatArray(NoiseSynth.BLOCK_SIZE)
                val startedAt = System.currentTimeMillis()
                val limitMs = if (durationMinutes > 0) durationMinutes * 60_000L else 0L

                while (running) {
                    if (limitMs > 0L && System.currentTimeMillis() - startedAt >= limitMs) break
                    val volume = graph.settingsStore.value.audio.volume
                    session.render(buffer, buffer.size, volume)
                    val written = track.write(buffer, 0, buffer.size, AudioTrack.WRITE_BLOCKING)
                    if (written < 0) break
                }
            } catch (error: Exception) {
                // 音频失败不影响熄灯流程
            } finally {
                try {
                    track?.pause()
                    track?.flush()
                } catch (ignored: Exception) {
                    // 忽略
                }
                try {
                    track?.release()
                } catch (ignored: Exception) {
                    // 忽略
                }
                finish()
            }
        }

        private fun finish() {
            handler.post {
                if (renderer === this) {
                    renderer = null
                    stopSelf()
                }
            }
        }
    }

    companion object {
        /** 供熄灯界面显示"播放中/已停止"。跨进程不存在问题：音频服务与本应用同进程。 */
        @Volatile
        var isPlaying: Boolean = false
            private set

        const val ACTION_PLAY = "com.xideng.sleep.action.AUDIO_PLAY"
        const val ACTION_STOP = "com.xideng.sleep.action.AUDIO_STOP"
        const val EXTRA_PRESET = "preset"
        const val EXTRA_DURATION_MINUTES = "durationMinutes"

        fun play(context: Context, presetId: String, durationMinutes: Int) {
            val intent = Intent(context, AudioService::class.java)
                .setAction(ACTION_PLAY)
                .putExtra(EXTRA_PRESET, presetId)
                .putExtra(EXTRA_DURATION_MINUTES, durationMinutes)
            try {
                context.startForegroundService(intent)
            } catch (error: Exception) {
                // 无法启动前台服务时静默失败：音频是增强能力，不是核心功能
            }
        }

        fun stop(context: Context) {
            val intent = Intent(context, AudioService::class.java).setAction(ACTION_STOP)
            try {
                context.startService(intent)
            } catch (error: Exception) {
                // 忽略
            }
        }
    }
}
