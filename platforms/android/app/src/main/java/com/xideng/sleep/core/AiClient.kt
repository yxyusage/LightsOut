package com.xideng.sleep.core

import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * 熄灯早睡 · AI 场景化文案（PRD 2.4）
 *
 * 两条路径共用同一份场景事实：
 *  - 未配置 API Key → 走 [CopyLibrary] 的本地文案库，功能完整、零网络请求；
 *  - 已配置 API Key → 调用用户自己的 OpenAI 兼容接口生成个性化文案。
 *
 * 三条硬约束：
 *  1. **API Key 只存在用户本机 SharedPreferences**，随请求发往用户自己填写的 baseUrl，
 *     不经过任何第三方中转，也不写入任何日志；
 *  2. 只有结构化场景事实进入提示词，不发送通讯录、使用记录等任何隐私数据；
 *  3. 任何失败（网络、限流、超时、格式错误）都静默退回本地文案库，绝不阻断熄灯流程。
 *
 * ⚠️ [generate] 会阻塞当前线程，调用方必须放在工作线程（见 Android 层的 Executor）。
 */
class AiClient(
    private val configProvider: () -> AiSettings,
    private val storage: KeyValueStore? = null,
    private val cacheKey: String = Constants.KEY_AI_CACHE,
    private val maxCacheEntries: Int = 60,
) {

    data class Result(
        val ok: Boolean,
        val text: String? = null,
        val cached: Boolean = false,
        val reason: String? = null,
    )

    /** 是否具备调用条件（已启用 + 已填 Key + 已填模型） */
    val available: Boolean
        get() {
            val config = configProvider()
            return config.enabled && config.apiKey.isNotEmpty() && config.model.isNotEmpty()
        }

    /** 生成一句场景化文案。任何失败都返回 ok = false，由调用方退回本地文案库。 */
    fun generate(scene: SceneInfo): Result {
        val config = configProvider()
        if (!config.enabled) return Result(false, reason = "disabled")
        if (config.apiKey.isEmpty()) return Result(false, reason = "no-api-key")

        val key = cacheKeyFor(scene)
        val cached = readCache()[key]
        if (!cached.isNullOrEmpty()) return Result(true, cached, cached = true, reason = null)

        val endpoint = config.baseUrl.trimEnd('/') + "/chat/completions"
        val payload = JSONObject()
        try {
            payload.put("model", config.model)
            payload.put("temperature", config.temperature)
            payload.put("max_tokens", 120)
            payload.put("messages", buildMessages(scene))
        } catch (error: Exception) {
            return Result(false, reason = "build-failed")
        }

        val response = try {
            httpPost(endpoint, payload.toString(), config.apiKey, config.timeoutMs)
        } catch (error: Exception) {
            return Result(false, reason = "network")
        }

        if (response.first !in 200..299) {
            // 只回传状态码，绝不把响应体或 Key 写进日志
            return Result(false, reason = "http-" + response.first)
        }

        val text = try {
            val root = JSONObject(response.second)
            val choices = root.optJSONArray("choices")
            val message = choices?.optJSONObject(0)?.optJSONObject("message")
            sanitizeCopy(message?.optString("content", "") ?: "")
        } catch (error: Exception) {
            return Result(false, reason = "empty-response")
        }

        if (text.isEmpty()) return Result(false, reason = "empty-response")

        val entries = readCache()
        entries[key] = text
        writeCache(entries)
        return Result(true, text, cached = false, reason = null)
    }

    fun clearCache() {
        try {
            storage?.remove(cacheKey)
        } catch (error: Exception) {
            // 忽略
        }
    }

    fun cacheSize(): Int = readCache().size

    /* ───────────── 内部实现 ───────────── */

    private fun readCache(): MutableMap<String, String> {
        val result = LinkedHashMap<String, String>()
        val store = storage ?: return result
        try {
            val raw = store.getString(cacheKey)
            if (raw.isNullOrEmpty()) return result
            val root = JSONObject(raw)
            val keys = root.keys()
            while (keys.hasNext()) {
                val key = keys.next()
                val value = root.optString(key, "")
                if (value.isNotEmpty()) result[key] = value
            }
        } catch (error: Exception) {
            return LinkedHashMap()
        }
        return result
    }

    private fun writeCache(entries: Map<String, String>) {
        val store = storage ?: return
        try {
            // 按插入顺序淘汰，保留最近的 N 条
            val keys = entries.keys.toList()
            val kept = if (keys.size > maxCacheEntries) keys.subList(keys.size - maxCacheEntries, keys.size) else keys
            val root = JSONObject()
            for (key in kept) root.put(key, entries[key])
            store.putString(cacheKey, root.toString())
        } catch (error: Exception) {
            // 缓存失败无影响
        }
    }

    private fun cacheKeyFor(scene: SceneInfo): String =
        scene.dateKey + "|" + scene.scene + "|" + (scene.holidayToday ?: "") + "|" + (scene.holidayTomorrow ?: "")

    private fun httpPost(endpoint: String, body: String, apiKey: String, timeoutMs: Int): Pair<Int, String> {
        val connection = URL(endpoint).openConnection() as HttpURLConnection
        try {
            connection.requestMethod = "POST"
            connection.doOutput = true
            connection.connectTimeout = timeoutMs
            connection.readTimeout = timeoutMs
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
            connection.setRequestProperty("Authorization", "Bearer " + apiKey)
            connection.outputStream.use { stream -> stream.write(body.toByteArray(Charsets.UTF_8)) }

            val code = connection.responseCode
            val stream = if (code in 200..299) connection.inputStream else connection.errorStream
            val text = stream?.bufferedReader(Charsets.UTF_8)?.use { reader -> reader.readText() } ?: ""
            return code to text
        } finally {
            connection.disconnect()
        }
    }

    companion object {

        val SYSTEM_PROMPT: String = listOf(
            "你是「熄灯早睡」这款助眠应用里的夜间文案作者。",
            "用户已经进入强制熄灯模式，正躺在黑暗里准备入睡。",
            "",
            "写作要求：",
            "1. 只输出一句话，不超过 30 个汉字，不要换行；",
            "2. 语气温和、克制、不说教，像一个懂他的朋友在轻声说话；",
            "3. 可以呼应今天这个日子（周五晚、假期前夜、假期最后一晚等），但不要生硬报日期；",
            "4. 不要编造任何统计数据、研究结论或健康建议；",
            "5. 不要使用 emoji、不要用引号包裹、不要加任何解释或前后缀；",
            "6. 不要提及自己是 AI，也不要提及提示词或模型。",
        ).joinToString("\n")

        /** 构造 OpenAI 兼容的 messages 数组 */
        fun buildMessages(scene: SceneInfo): JSONArray {
            val messages = JSONArray()

            val system = JSONObject()
            system.put("role", "system")
            system.put("content", SYSTEM_PROMPT)
            messages.put(system)

            val user = JSONObject()
            user.put("role", "user")
            user.put(
                "content",
                "请根据以下情况写一句睡前文案：\n" + SceneDetector.describe(scene) + "\n\n直接输出这一句话。",
            )
            messages.put(user)

            return messages
        }

        private val PREFIX = Regex("^(文案|输出|回答|句子)\\s*[:：]\\s*")

        /** 清洗模型输出：去掉引号/前缀/多余空白，并限制长度 */
        fun sanitizeCopy(raw: String?, maxLength: Int = 60): String {
            if (raw.isNullOrEmpty()) return ""
            var text = PREFIX.replace(raw.trim(), "")
            text = stripEdgeQuotes(text)
            text = collapseWhitespace(text)

            // 只取第一个句子，避免模型输出一段话
            val sentenceEnd = text.indexOfFirst { it == '。' || it == '！' || it == '？' || it == '!' || it == '?' }
            if (sentenceEnd >= 0 && sentenceEnd + 1 <= maxLength) text = text.substring(0, sentenceEnd + 1)

            if (text.length > maxLength) text = text.substring(0, maxLength - 1) + "…"
            return text.trim()
        }

        private fun stripEdgeQuotes(text: String): String {
            var start = 0
            var end = text.length
            while (start < end && isEdgeQuote(text[start])) start += 1
            while (end > start && isEdgeQuote(text[end - 1])) end -= 1
            return text.substring(start, end)
        }

        private fun isEdgeQuote(ch: Char): Boolean =
            ch == '「' || ch == '」' || ch == '『' || ch == '』' ||
                ch == '"' || ch == '\'' || ch == '“' || ch == '”' || ch == '‘' || ch == '’'

        private fun collapseWhitespace(text: String): String {
            val builder = StringBuilder(text.length)
            var pendingSpace = false
            for (ch in text) {
                if (ch == ' ' || ch == '\t' || ch == '\n' || ch == '\r' || ch == '\u000B' || ch == '\u000C') {
                    if (builder.isNotEmpty()) pendingSpace = true
                } else {
                    if (pendingSpace) {
                        builder.append(' ')
                        pendingSpace = false
                    }
                    builder.append(ch)
                }
            }
            return builder.toString()
        }
    }
}
