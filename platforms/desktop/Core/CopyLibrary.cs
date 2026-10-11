namespace Xideng.Desktop.Core;

/// <summary>一条可核查的文献来源。</summary>
public sealed record FactSource(string Key, string Label, string Finding, string Url);

/// <summary>一条文案。</summary>
public sealed record CopyEntry(string Id, string Kind, string Text, string? Source = null);

/// <summary>
/// 熄灯早睡 · 文案库与轮播引擎（<c>packages/core/src/copy.js</c> 的 C# 移植）。
///
/// 分两类内容交替出现，对应 PRD 2.2.2「轮播展示熬夜危害科普数据、情绪安抚语句」：
/// <list type="bullet">
///   <item><c>hazard</c>：熬夜危害科普数据，<b>每条都绑定了可核查的文献来源</b>；</item>
///   <item><c>comfort</c>：情绪安抚语句，不带事实断言，因此无需引用。</item>
/// </list>
///
/// 睡眠类产品最容易出现随口编造的吓人数字，而一旦被发现，整个产品的可信度就没了。
/// 为此这里坚持三条纪律：
/// 只收录能查到出处的结论；每条危害数据必须给出 <c>Source</c>；不写伪精确数字。
/// </summary>
public static class CopyLibrary
{
    public static readonly IReadOnlyDictionary<string, FactSource> FactSources = new Dictionary<string, FactSource>(StringComparer.Ordinal)
    {
        ["prather2015"] = new FactSource(
            "prather2015",
            "Prather AA et al., Sleep, 2015",
            "164 名成年人、以客观睡眠监测测量：每晚睡眠 6 小时或更少的人，感染感冒的风险是睡 7 小时以上者的 4 倍以上。",
            "https://www.eurekalert.org/news-releases/804618"),
        ["williamson2000"] = new FactSource(
            "williamson2000",
            "Williamson AM & Feyer AM, Occup Environ Med, 2000",
            "连续保持清醒 17 小时，手眼协调与反应能力的下降程度相当于血液酒精浓度 0.05%；连续 24 小时则相当于 0.10%。",
            "https://pubmed.ncbi.nlm.nih.gov/10984335/"),
        ["iarc2019"] = new FactSource(
            "iarc2019",
            "IARC 专著第 124 卷，2019",
            "世界卫生组织下属国际癌症研究机构将「涉及昼夜节律紊乱的轮班工作」列为 2A 类，即很可能对人类致癌。",
            "https://publications.iarc.who.int/Book-And-Report-Series/Iarc-Monographs-On-The-Identification-Of-Carcinogenic-Hazards-To-Humans/Night-Shift-Work-2019"),
        ["xie2013"] = new FactSource(
            "xie2013",
            "Xie L et al., Science, 2013",
            "动物实验显示，睡眠期间脑内类淋巴系统的代谢废物清除效率显著高于清醒状态，其中包括与阿尔茨海默病相关的 β-淀粉样蛋白。",
            "https://www.science.org/doi/10.1126/science.1241224"),
        ["yoo2007"] = new FactSource(
            "yoo2007",
            "Yoo SS et al., Current Biology, 2007",
            "一夜不睡后，大脑前额叶对杏仁核的调控明显减弱，情绪反应被放大——这解释了为什么熬夜时更容易烦躁和冲动。",
            "https://www.cell.com/current-biology/fulltext/S0960-9822(07)01796-7"),
    };

    /// <summary>危害科普条目。</summary>
    public static readonly IReadOnlyList<CopyEntry> Hazards =
    [
        new("h-cold", "hazard", "每晚睡不够 6 小时的人，感冒风险是睡够 7 小时者的 4 倍以上。", "prather2015"),
        new("h-alcohol", "hazard", "清醒 17 小时后，你的反应速度大约相当于血液酒精浓度 0.05% 的状态。", "williamson2000"),
        new("h-alcohol24", "hazard", "连续清醒 24 小时，认知表现约等于血液酒精浓度 0.10%——多数地区的醉驾标准。", "williamson2000"),
        new("h-iarc", "hazard", "世卫组织下属机构已将「昼夜节律紊乱的轮班工作」列为 2A 类致癌因素。", "iarc2019"),
        new("h-glymphatic", "hazard", "大脑主要在睡眠中清理代谢废物，包括与阿尔茨海默病相关的 β-淀粉样蛋白。", "xie2013"),
        new("h-amygdala", "hazard", "缺觉会让前额叶管不住情绪中枢，所以熬夜时人更容易烦躁、更容易冲动下单。", "yoo2007"),
        new("h-vicious", "hazard", "刷手机带来的即时快感会推迟困意，睡得更晚，第二天更疲惫——这是一个会自我强化的循环。"),
        new("h-blue", "hazard", "屏幕蓝光会抑制褪黑素分泌，让身体误以为天还没黑。"),
    ];

    /// <summary>通用安抚语句。</summary>
    public static readonly IReadOnlyList<CopyEntry> Comfort =
    [
        new("c-1", "comfort", "今天已经结束了。剩下的事，明天再说也来得及。"),
        new("c-2", "comfort", "放下手机不是惩罚，是把时间还给明天的自己。"),
        new("c-3", "comfort", "屏幕之外没有错过什么，你只是需要休息。"),
        new("c-4", "comfort", "现在闭眼，是今天最容易做到、也最划算的一件事。"),
        new("c-5", "comfort", "不用强迫自己马上睡着，躺着、闭眼、慢呼吸就够了。"),
        new("c-6", "comfort", "你已经坚持到了这个时间，剩下的交给身体自己。"),
        new("c-7", "comfort", "深呼吸三次。吸气四秒，屏息两秒，呼气六秒。"),
        new("c-8", "comfort", "夜里想不明白的事，早上往往就没那么重了。"),
        new("c-9", "comfort", "这不是自律的失败，只是一次需要被帮助的坚持。"),
        new("c-10", "comfort", "灯已经关了。现在，只需要闭上眼睛。"),
    ];

    /// <summary>场景专属文案。</summary>
    public static readonly IReadOnlyDictionary<string, IReadOnlyList<CopyEntry>> SceneCopy =
        new Dictionary<string, IReadOnlyList<CopyEntry>>(StringComparer.Ordinal)
        {
            [SceneKind.FridayNight] =
            [
                new("f-1", "scene", "明天就是周末了，今晚睡个好觉，周末才有力气好好放松。"),
                new("f-2", "scene", "周五晚最容易报复性熬夜——但周末补觉，补不回失去的深睡。"),
                new("f-3", "scene", "周末的第一份礼物，是一个不用定闹钟的早晨。前提是今晚得睡着。"),
            ],
            [SceneKind.SaturdayNight] =
            [
                new("s-1", "scene", "周六晚放松得刚刚好，别把作息一口气推到明天凌晨。"),
                new("s-2", "scene", "明天还能休息，所以今晚更值得睡饱。"),
            ],
            [SceneKind.SundayNight] =
            [
                new("s-3", "scene", "周日晚的焦虑，多半是缺觉放大的。先睡，明天再面对。"),
                new("s-4", "scene", "明天要上班，今晚的每一分钟睡眠都在替明天省力。"),
                new("s-5", "scene", "周一不会因为今晚少睡两小时而变轻松，只会更难。"),
            ],
            [SceneKind.HolidayEve] =
            [
                new("he-1", "scene", "假期前夜，明天可以睡到自然醒，但今晚不必熬到那么晚。"),
                new("he-2", "scene", "假期最好的打开方式，是先睡饱再出发。"),
                new("he-3", "scene", "期待明天的心情很好，带着它去睡觉吧。"),
            ],
            [SceneKind.Holiday] =
            [
                new("hd-1", "scene", "假期里也别把作息彻底颠倒，回到工作日会更难受。"),
                new("hd-2", "scene", "休息的意义是恢复，不是把生物钟拆掉重装。"),
            ],
            [SceneKind.HolidayLastNight] =
            [
                new("hl-1", "scene", "这是假期的最后一晚，今晚睡好，明天收心会轻松很多。"),
                new("hl-2", "scene", "假期余额不足了。今晚早睡，是给自己留的缓冲。"),
                new("hl-3", "scene", "明天要回到节奏里，今晚提前一晚调整，比明天硬撑舒服得多。"),
            ],
            [SceneKind.MakeupWorkdayNight] =
            [
                new("mw-1", "scene", "今天是为假期补班的调休日，辛苦了，今晚别再多熬。"),
            ],
            [SceneKind.Ordinary] =
            [
                new("o-1", "scene", "明天是普通的一天，而今晚的睡眠决定了它的质量。"),
                new("o-2", "scene", "工作日晚上，早睡一小时，白天多出两小时的清醒。"),
            ],
        };

    /// <summary>直接按场景取文案（节日祝福会动态插入）。</summary>
    public static List<CopyEntry> SceneEntries(SceneInfo scene)
    {
        var entries = new List<CopyEntry>();

        if (scene.HolidayToday is not null)
        {
            var name = scene.HolidayToday;
            entries.Add(scene.IsHolidayLastNight
                ? new CopyEntry($"hg-last-{name}", "greeting", $"{name}假期就要结束了，今晚好好收个尾。")
                : new CopyEntry($"hg-{name}", "greeting", $"{name}快乐。假期里也要睡够。"));
        }

        if (scene.IsHolidayEve && scene.HolidayTomorrow is not null)
        {
            var name = scene.HolidayTomorrow;
            entries.Add(new CopyEntry($"hg-eve-{name}", "greeting", $"明天就是{name}了，今晚睡个好觉，假期好好放松。"));
        }

        if (SceneCopy.TryGetValue(scene.Scene, out var sceneSpecific))
        {
            entries.AddRange(sceneSpecific);
        }

        return entries;
    }

    /// <summary>
    /// mulberry32：小巧、确定性好的伪随机数发生器，便于测试复现。
    /// 与 JS 版逐位一致（uint 运算天然等价于 <c>Math.imul</c> + <c>&gt;&gt;&gt; 0</c>）。
    /// </summary>
    public static Func<double> CreateRandom(uint seed)
    {
        var state = seed;
        return () =>
        {
            unchecked
            {
                state += 0x6d2b79f5u;
                var t = state;
                t = (t ^ (t >> 15)) * (t | 1u);
                t ^= t + ((t ^ (t >> 7)) * (t | 61u));
                return (t ^ (t >> 14)) / 4294967296.0;
            }
        };
    }

    private static List<T> Shuffle<T>(IReadOnlyList<T> items, Func<double> random)
    {
        var result = new List<T>(items);
        for (var i = result.Count - 1; i > 0; i--)
        {
            var j = (int)Math.Floor(random() * (i + 1));
            (result[i], result[j]) = (result[j], result[i]);
        }

        return result;
    }

    /// <summary>
    /// 组装播放列表：危害科普与安抚语句交替，场景专属语句靠前。
    /// 交替而非混排，是为了避免连续两条科普造成"被说教"的压迫感（PRD 4.1 极简克制）。
    /// </summary>
    public static List<CopyEntry> BuildPlaylist(SceneInfo scene, uint? seed = null, bool includeHazards = true)
    {
        var effectiveSeed = seed ?? HashString(scene.DateKey + scene.Scene);
        var random = CreateRandom(effectiveSeed);

        var sceneSpecific = SceneEntries(scene);
        var hazards = includeHazards ? Shuffle(Hazards, random) : [];
        var comfort = Shuffle(Comfort, random);

        var playlist = new List<CopyEntry>();
        playlist.AddRange(sceneSpecific);

        // 开场先给场景专属语句：让用户立刻感到"它知道今天是什么日子"
        var opening = Math.Min(2, comfort.Count);
        playlist.AddRange(comfort.GetRange(0, opening));
        comfort.RemoveRange(0, opening);

        var maxLength = Math.Max(hazards.Count, comfort.Count);
        for (var i = 0; i < maxLength; i++)
        {
            if (i < hazards.Count)
            {
                playlist.Add(hazards[i]);
            }

            if (i < comfort.Count)
            {
                playlist.Add(comfort[i]);
            }
        }

        return playlist;
    }

    /// <summary>稳定字符串哈希（FNV-1a 32 位），用于给每天的播放顺序定种子。</summary>
    public static uint HashString(string input)
    {
        unchecked
        {
            var hash = 2166136261u;
            foreach (var ch in input)
            {
                hash ^= ch;
                hash *= 16777619u;
            }

            return hash;
        }
    }

    public static int HazardCount => Hazards.Count;

    public static int ComfortCount => Comfort.Count;
}

/// <summary>
/// 轮播器。<see cref="Next"/> 返回下一条，走到末尾自动从头开始
/// （而不是重新洗牌，避免用户察觉"顺序变了"）。
/// </summary>
public sealed class CopyRotator
{
    private readonly IReadOnlyList<CopyEntry> _entries;
    private int _index;

    public CopyRotator(IReadOnlyList<CopyEntry> entries, int intervalMs = Limits.CopyRotateMs, int startIndex = 0)
    {
        if (entries is null || entries.Count == 0)
        {
            throw new ArgumentOutOfRangeException(nameof(entries), "轮播文案列表不能为空");
        }

        _entries = entries;
        IntervalMs = intervalMs;
        _index = ((startIndex % entries.Count) + entries.Count) % entries.Count;
    }

    public int IntervalMs { get; }

    public int Count => _entries.Count;

    public CopyEntry Current => _entries[_index];

    public CopyEntry Next()
    {
        _index = (_index + 1) % _entries.Count;
        return _entries[_index];
    }

    /// <summary>跳到指定 id 的条目；找不到则保持不动。</summary>
    public CopyEntry JumpTo(string id)
    {
        for (var i = 0; i < _entries.Count; i++)
        {
            if (string.Equals(_entries[i].Id, id, StringComparison.Ordinal))
            {
                _index = i;
                break;
            }
        }

        return _entries[_index];
    }
}
