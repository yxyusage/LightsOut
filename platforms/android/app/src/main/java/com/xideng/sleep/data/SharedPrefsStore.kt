package com.xideng.sleep.data

import android.content.Context
import com.xideng.sleep.core.Constants
import com.xideng.sleep.core.KeyValueStore

/**
 * [KeyValueStore] 的 Android 实现。
 *
 * 全部设置、密码摘要、额度与违规记录都只落在这个文件里，
 * 且 `allowBackup=false`（见 AndroidManifest），因此不会进入云备份——
 * 这是 PRD 六「所有设置数据本地存储，不上传用户隐私」的落地方式。
 */
class SharedPrefsStore(context: Context) : KeyValueStore {

    private val prefs = context.applicationContext
        .getSharedPreferences(Constants.PREFS_FILE, Context.MODE_PRIVATE)

    override fun getString(key: String): String? = prefs.getString(key, null)

    override fun putString(key: String, value: String) {
        prefs.edit().putString(key, value).apply()
    }

    override fun remove(key: String) {
        prefs.edit().remove(key).apply()
    }
}
