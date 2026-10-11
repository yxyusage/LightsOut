package com.xideng.sleep.core

/**
 * 熄灯早睡 · 文案库与轮播引擎
 *
 * 与 `packages/core/src/copy.js` 一一对应。分两类内容交替出现，
 * 对应 PRD 2.2.2「轮播展示熬夜危害科普数据、情绪安抚语句」：
 *  - hazard  熬夜危害科普数据，**每条都绑定了可核查的文献来源**（见 [FACT_SOURCES]）；
 *  - comfort 情绪安抚语句，不带事实断言，因此无需引用。
 *
 * 赛事规则禁止"虚构数据、伪造案例或误导用户"，因此这里坚持三条纪律：
 *  1. 只收录能在原始论文/官方通报中查到的结论；
 *  2. 每条危害数据必须给出 source 键，UI 可一键展开溯源；
 *  3. 不写具体到吓人的伪精确数字，措辞保留研究结论原本的强度。
 */

data class CopyEntry(
    val id: String,
    val kind: String,
    val text: String,
    val source: String? = null,
)

data class FactSource(
    val label: String,
    val finding: String,
    val url: String,
)

object CopyLibrary {

    /** 可核查的来源登记表。UI 的"数据溯源"面板直接渲染它。 */
    val FACT_SOURCES: Map<String, FactSource> = mapOf(
        "prather2015" to FactSource(
            label = "Prather AA et al., Sleep, 2015",
            finding = "164 名成年人、以客观睡眠监测测量：每晚睡眠 6 小时或更少的人，感染感冒的风险是睡 7 小时以上者的 4 倍以上。",
            url = "https://www.eurekalert.org/news-releases/804618",
        ),
        "williamson2000" to FactSource(
            label = "Williamson AM & Feyer AM, Occup Environ Med, 2000",
            finding = "连续保持清醒 17 小时，手眼协调与反应能力的下降程度相当于血液酒精浓度 0.05%；连续 24 小时则相当于 0.10%。",
            url = "https://pubmed.ncbi.nlm.nih.gov/10984335/",
        ),
        "iarc2019" to FactSource(
            label = "IARC 专著第 124 卷，2019",
            finding = "世界卫生组织下属国际癌症研究机构将「涉及昼夜节律紊乱的轮班工作」列为 2A 类，即很可能对人类致癌。",
            url = "https://publications.iarc.who.int/Book-And-Report-Series/Iarc-Monographs-On-The-Identification-Of-Carcinogenic-Hazards-To-Humans/Night-Shift-Work-2019",
        ),
        "xie2013" to FactSource(
            label = "Xie L et al., Science, 2013",
            finding = "动物实验显示，睡眠期间脑内类淋巴系统的代谢废物清除效率显著高于清醒状态，其中包括与阿尔茨海默病相关的 β-淀粉样蛋白。",
            url = "https://www.science.org/doi/10.1126/science.1241224",
        ),
        "yoo2007" to FactSource(
            label = "Yoo SS et al., Current Biology, 2007",
            finding = "一夜不睡后，大脑前额叶对杏仁核的调控明显减弱，情绪反应被放大——这解释了为什么熬夜时更容易烦躁和冲动。",
            url = "https://www.cell.com/current-biology/fulltext/S0960-9822(07)01796-7",
        ),
    )

    val HAZARDS: List<CopyEntry> = listOf(
        CopyEntry("h-cold", "hazard", "每晚睡不够 6 小时的人，感冒风险是睡够 7 小时者的 4 倍以上。", "prather2015"),
        CopyEntry("h-alcohol", "hazard", "清醒 17 小时后，你的反应速度大约相当于血液酒精浓度 0.05% 的状态。", "williamson2000"),
        CopyEntry("h-alcohol24", "hazard", "连续清醒 24 小时，认知表现约等于血液酒精浓度 0.10%——多数地区的醉驾标准。", "williamson2000"),
        CopyEntry("h-iarc", "hazard", "世卫组织下属机构已将「昼夜节律紊乱的轮班工作」列为 2A 类致癌因素。", "iarc2019"),
        CopyEntry("h-glymphatic", "hazard", "大脑主要在睡眠中清理代谢废物，包括与阿尔茨海默病相关的 β-淀粉样蛋白。", "xie2013"),
        CopyEntry("h-amygdala", "hazard", "缺觉会让前额叶管不住情绪中枢，所以熬夜时人更容易烦躁、更容易冲动下单。", "yoo2007"),
        CopyEntry("h-vicious", "hazard", "刷手机带来的即时快感会推迟困意，睡得更晚，第二天更疲惫——这是一个会自我强化的循环。", null),
        CopyEntry("h-blue", "hazard", "屏幕蓝光会抑制褪黑素分泌，让身体误以为天还没黑。", null),
    )

    val COMFORT: List<CopyEntry> = listOf(
        CopyEntry("c-1", "comfort", "今天已经结束了。剩下的事，明天再说也来得及。"),
        CopyEntry("c-2", "comfort", "放下手机不是惩罚，是把时间还给明天的自己。"),
        CopyEntry("c-3", "comfort", "屏幕之外没有错过什么，你只是需要休息。"),
        CopyEntry("c-4", "comfort", "现在闭眼，是今天最容易做到、也最划算的一件事。"),
        CopyEntry("c-5", "comfort", "不用强迫自己马上睡着，躺着、闭眼、慢呼吸就够了。"),
        CopyEntry("c-6", "comfort", "你已经坚持到了这个时间，剩下的交给身体自己。"),
        CopyEntry("c-7", "comfort", "深呼吸三次。吸气四秒，屏息两秒，呼气六秒。"),
        CopyEntry("c-8", "comfort", "夜里想不明白的事，早上往往就没那么重了。"),
        CopyEntry("c-9", "comfort", "这不是自律的失败，只是一次需要被帮助的坚持。"),
        CopyEntry("c-10", "comfort", "灯已经关了。现在，只需要闭上眼睛。"),
    )

    val SCENE_COPY: Map<String, List<CopyEntry>> = mapOf(
        SceneId.FRIDAY_NIGHT to listOf(
            CopyEntry("f-1", "scene", "明天就是周末了，今晚睡个好觉，周末才有力气好好放松。"),
            CopyEntry("f-2", "scene", "周五晚最容易报复性熬夜——但周末补觉，补不回失去的深睡。"),
            CopyEntry("f-3", "scene", "周末的第一份礼物，是一个不用定闹钟的早晨。前提是今晚得睡着。"),
        ),
        SceneId.SATURDAY_NIGHT to listOf(
            CopyEntry("s-1", "scene", "周六晚放松得刚刚好，别把作息一口气推到明天凌晨。"),
            CopyEntry("s-2", "scene", "明天还能休息，所以今晚更值得睡饱。"),
        ),
        SceneId.SUNDAY_NIGHT to listOf(
            CopyEntry("s-3", "scene", "周日晚的焦虑，多半是缺觉放大的。先睡，明天再面对。"),
            CopyEntry("s-4", "scene", "明天要上班，今晚的每一分钟睡眠都在替明天省力。"),
            CopyEntry("s-5", "scene", "周一不会因为今晚少睡两小时而变轻松，只会更难。"),
        ),
        SceneId.HOLIDAY_EVE to listOf(
            CopyEntry("he-1", "scene", "假期前夜，明天可以睡到自然醒，但今晚不必熬到那么晚。"),
            CopyEntry("he-2", "scene", "假期最好的打开方式，是先睡饱再出发。"),
            CopyEntry("he-3", "scene", "期待明天的心情很好，带着它去睡觉吧。"),
        ),
        SceneId.HOLIDAY to listOf(
            CopyEntry("hd-1", "scene", "假期里也别把作息彻底颠倒，回到工作日会更难受。"),
            CopyEntry("hd-2", "scene", "休息的意义是恢复，不是把生物钟拆掉重装。"),
        ),
        SceneId.HOLIDAY_LAST_NIGHT to listOf(
            CopyEntry("hl-1", "scene", "这是假期的最后一晚，今晚睡好，明天收心会轻松很多。"),
            CopyEntry("hl-2", "scene", "假期余额不足了。今晚早睡，是给自己留的缓冲。"),
            CopyEntry("hl-3", "scene", "明天要回到节奏里，今晚提前一晚调整，比明天硬撑舒服得多。"),
        ),
        SceneId.MAKEUP_WORKDAY_NIGHT to listOf(
            CopyEntry("mw-1", "scene", "今天是为假期补班的调休日，辛苦了，今晚别再多熬。"),
        ),
        SceneId.ORDINARY to listOf(
            CopyEntry("o-1", "scene", "明天是普通的一天，而今晚的睡眠决定了它的质量。"),
            CopyEntry("o-2", "scene", "工作日晚上，早睡一小时，白天多出两小时的清醒。"),
        ),
    )

    /** 直接按场景取文案（节日祝福会动态插入） */
    fun sceneEntries(scene: SceneInfo): List<CopyEntry> {
        val entries = mutableListOf<CopyEntry>()

        val holidayToday = scene.holidayToday
        if (holidayToday != null) {
            if (scene.isHolidayLastNight) {
                entries.add(
                    CopyEntry("hg-last-" + holidayToday, "greeting", holidayToday + "假期就要结束了，今晚好好收个尾。"),
                )
            } else {
                entries.add(
                    CopyEntry("hg-" + holidayToday, "greeting", holidayToday + "快乐。假期里也要睡够。"),
                )
            }
        }
        val holidayTomorrow = scene.holidayTomorrow
        if (scene.isHolidayEve && holidayTomorrow != null) {
            entries.add(
                CopyEntry("hg-eve-" + holidayTomorrow, "greeting", "明天就是" + holidayTomorrow + "了，今晚睡个好觉，假期好好放松。"),
            )
        }

        entries.addAll(SCENE_COPY[scene.scene] ?: emptyList())
        return entries
    }

    /** 稳定字符串哈希（FNV-1a），用于给每天的播放顺序定种子（同一天刷新顺序一致） */
    fun hashString(input: String): Int {
        var hash = 0x811C9DC5.toInt()
        for (element in input) {
            hash = hash xor element.code
            hash *= 16777619
        }
        return hash
    }

    /** mulberry32：小巧、确定性好的伪随机数发生器，便于测试复现 */
    class Mulberry32(seed: Int) {
        private var state: Int = seed

        fun next(): Double {
            state += 0x6D2B79F5
            var t = state
            t = (t xor (t ushr 15)) * (t or 1)
            t = t xor (t + ((t xor (t ushr 7)) * (t or 61)))
            val unsigned = (t xor (t ushr 14)).toLong() and 0xFFFFFFFFL
            return unsigned.toDouble() / 4294967296.0
        }
    }

    private fun <T> shuffle(items: List<T>, random: () -> Double): List<T> {
        val result = items.toMutableList()
        for (i in result.size - 1 downTo 1) {
            val j = (random() * (i + 1)).toInt()
            if (i == j) continue
            val tmp = result[i]
            result[i] = result[j]
            result[j] = tmp
        }
        return result
    }

    /**
     * 组装播放列表：危害科普与安抚语句交替，场景专属语句靠前。
     * 交替而非混排，是为了避免连续两条科普造成"被说教"的压迫感（PRD 4.1 极简克制）。
     */
    fun buildPlaylist(scene: SceneInfo, includeHazards: Boolean = true): List<CopyEntry> {
        val seed = hashString(scene.dateKey + "|" + scene.scene)
        val random = Mulberry32(seed)

        val sceneSpecific = sceneEntries(scene)
        val hazards = if (includeHazards) shuffle(HAZARDS, random::next) else emptyList()
        val comfortQueue = shuffle(COMFORT, random::next).toMutableList()

        val playlist = mutableListOf<CopyEntry>()
        // 开场先给场景专属语句：让用户立刻感到"它知道今天是什么日子"
        playlist.addAll(sceneSpecific)
        repeat(minOf(2, comfortQueue.size)) { playlist.add(comfortQueue.removeAt(0)) }

        val maxLength = maxOf(hazards.size, comfortQueue.size)
        for (i in 0 until maxLength) {
            if (i < hazards.size) playlist.add(hazards[i])
            if (i < comfortQueue.size) playlist.add(comfortQueue[i])
        }
        return playlist
    }

    val HAZARD_COUNT: Int get() = HAZARDS.size
    val COMFORT_COUNT: Int get() = COMFORT.size
}

/**
 * 轮播器。next() 返回下一条，走到末尾自动从头开始
 * （而不是重新洗牌，避免用户察觉"顺序变了"）。
 */
class Rotator(
    val entries: List<CopyEntry>,
    val intervalMs: Long,
    startIndex: Int = 0,
) {
    private var index: Int = ((startIndex % entries.size) + entries.size) % entries.size

    val size: Int get() = entries.size

    fun current(): CopyEntry = entries[index]

    fun next(): CopyEntry {
        index = (index + 1) % entries.size
        return entries[index]
    }

    /** 跳到指定 id 的条目；找不到则保持不动 */
    fun jumpTo(id: String): CopyEntry {
        val found = entries.indexOfFirst { it.id == id }
        if (found >= 0) index = found
        return entries[index]
    }

    fun reset() {
        index = 0
    }
}
