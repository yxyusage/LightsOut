package com.xideng.sleep.ui

import android.content.Context
import android.widget.Toast

/** 熄灯早睡 · UI 小工具 */

fun Context.toast(message: String) {
    Toast.makeText(this, message, Toast.LENGTH_SHORT).show()
}
