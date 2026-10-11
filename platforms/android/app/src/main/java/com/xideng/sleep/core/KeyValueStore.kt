package com.xideng.sleep.core

/**
 * 熄灯早睡 · 存储适配层
 *
 * PRD 六、非功能需求："所有设置数据本地存储，不上传用户隐私"。
 * 因此这里只做本机持久化，且**读取永远不能抛异常**——存储损坏时必须回退到默认值，
 * 否则用户会卡在莫名其妙的白屏里。
 *
 * Android 端实现见 `com.xideng.sleep.data.SharedPrefsStore`；
 * 内存实现用于单元测试与 SharedPreferences 不可用的极端情况。
 */
interface KeyValueStore {
    fun getString(key: String): String?
    fun putString(key: String, value: String)
    fun remove(key: String)
}

/** 进程内存储，作为持久化不可用时的兜底 */
class MemoryStore(seed: Map<String, String> = emptyMap()) : KeyValueStore {
    private val map: MutableMap<String, String> = LinkedHashMap(seed)

    override fun getString(key: String): String? = map[key]

    override fun putString(key: String, value: String) {
        map[key] = value
    }

    override fun remove(key: String) {
        map.remove(key)
    }

    fun dump(): Map<String, String> = LinkedHashMap(map)
}
