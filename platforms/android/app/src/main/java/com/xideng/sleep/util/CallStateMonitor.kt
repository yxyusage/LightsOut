package com.xideng.sleep.util

import android.content.Context
import android.media.AudioManager
import android.os.Build
import android.telecom.TelecomManager
import android.telephony.TelephonyManager

/**
 * 熄灯早睡 · 通话状态（PRD 2.2.4：系统来电不受熄灯限制，通话结束后自动退回黑屏界面）
 *
 * 三级判定，任何一级成功即可：
 *  1. [TelecomManager.isInCall]（Android 12+，无需任何权限，最可靠）；
 *  2. [AudioManager.getMode] 处于通话模式（全部版本可用，无需权限）；
 *  3. [TelephonyManager.getCallState] 处于振铃/接通（需要 READ_PHONE_STATE，最精确）。
 *
 * 这样即使用户拒绝授予 READ_PHONE_STATE，放行逻辑依然成立。
 */
object CallStateMonitor {

    fun isInCall(context: Context): Boolean {
        if (isInCallViaTelecom(context)) return true
        if (isInCallViaAudioMode(context)) return true
        if (isInCallViaTelephony(context)) return true
        return false
    }

    private fun isInCallViaTelecom(context: Context): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return false
        val telecom = context.getSystemService(Context.TELECOM_SERVICE) as? TelecomManager ?: return false
        return try {
            telecom.isInCall
        } catch (error: Exception) {
            false
        }
    }

    private fun isInCallViaAudioMode(context: Context): Boolean {
        val audio = context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager ?: return false
        return audio.mode == AudioManager.MODE_IN_CALL || audio.mode == AudioManager.MODE_IN_COMMUNICATION
    }

    private fun isInCallViaTelephony(context: Context): Boolean {
        if (!Permissions.hasPhoneStatePermission(context)) return false
        val telephony = context.getSystemService(Context.TELEPHONY_SERVICE) as? TelephonyManager ?: return false
        return try {
            when (telephony.callState) {
                TelephonyManager.CALL_STATE_RINGING, TelephonyManager.CALL_STATE_OFFHOOK -> true
                else -> false
            }
        } catch (error: SecurityException) {
            false
        }
    }
}
