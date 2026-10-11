package com.xideng.sleep.core

import java.security.MessageDigest

/**
 * 熄灯早睡 · 紧急解除密码
 *
 * 定位说明（请勿误读为安全机制）：PRD 2.2.5 的密码是**防冲动的一次减速带**，
 * 挡住的是"半夜手滑想退出"的瞬时决定，不是攻击者。密码哈希与全部设置一样
 * 只存在用户本机，本应用不获取、不上传（PRD 六、隐私安全）。
 *
 * 因此这里使用固定的域分隔前缀 + SHA-256，而**不做**慢哈希/KDF：
 * 引入盐值存储与迭代参数只会增加复杂度，却挡不住能直接读 SharedPreferences 的人。
 * 这个取舍是有意为之，与 Web 版完全一致（同前缀、同算法、同十六进制输出）。
 */
object PasswordHasher {

    /** 域分隔前缀。必须与 `packages/core/src/password.js` 的 DOMAIN_PREFIX 保持一致。 */
    const val DOMAIN_PREFIX = "xideng::emergency::v1"

    private val HEX = "0123456789abcdef".toCharArray()

    /**
     * 计算密码摘要。
     * @return 小写十六进制摘要；密码为空字符串时也会得到一个确定的值。
     */
    fun hash(password: String?): String {
        val payload = DOMAIN_PREFIX + "|" + (password ?: "")
        val digest = MessageDigest.getInstance("SHA-256").digest(payload.toByteArray(Charsets.UTF_8))
        return toHex(digest)
    }

    /**
     * 校验密码。
     * @param expectedHash 空字符串表示尚未设置密码，直接判定为不匹配。
     */
    fun verify(password: String?, expectedHash: String?): Boolean {
        if (expectedHash.isNullOrEmpty()) return false
        val actual = hash(password)
        // 逐字符比较，避免提前返回造成的时长差异（此处收益有限，但成本同样极低）
        if (actual.length != expectedHash.length) return false
        var diff = 0
        for (i in actual.indices) {
            diff = diff or (actual[i].code xor expectedHash[i].code)
        }
        return diff == 0
    }

    /** 密码强度提示，用于首次引导界面（返回人类可读的建议，空列表表示合格） */
    fun advice(password: String?): List<String> {
        val text = password ?: ""
        val advice = mutableListOf<String>()
        if (text.length < 4) advice.add("至少 4 位")
        if (text.isNotEmpty() && text.all { it.isDigit() }) advice.add("纯数字容易误触通过，建议混合字母")
        if (text.length > 32) advice.add("不要超过 32 位，以免难以输入")
        return advice
    }

    private fun toHex(bytes: ByteArray): String {
        val builder = StringBuilder(bytes.size * 2)
        for (byte in bytes) {
            val value = byte.toInt() and 0xFF
            builder.append(HEX[value ushr 4]).append(HEX[value and 0x0F])
        }
        return builder.toString()
    }
}
