/**
 * 熄灯早睡 · 文案库与轮播引擎
 *
 * 分两类内容交替出现，对应 PRD 2.2.2「轮播展示熬夜危害科普数据、情绪安抚语句」：
 *  - `hazard`  熬夜危害科普数据，**每条都绑定了可核查的文献来源**（见 FACT_SOURCES）；
 *  - `comfort` 情绪安抚语句，不带事实断言，因此无需引用。
 *
 * 睡眠类产品最容易出现随口编造的吓人数字，而一旦被发现，整个产品的可信度就没了。
为此这里坚持三条纪律：
 *  1. 只收录能在原始论文/官方通报中查到的结论；
 *  2. 每条危害数据必须给出 `source` 键，UI 可一键展开溯源；
 *  3. 不写具体到吓人的伪精确数字，措辞保留研究结论原本的强度（"风险升高"而非"必然致癌"）。
 */

import { SCENE } from "./scene.js";

/** 可核查的来源登记表。UI 的"数据溯源"面板直接渲染它。 */
export const FACT_SOURCES = {
  prather2015: {
    label: "Prather AA et al., Sleep, 2015",
    finding: "164 名成年人、以客观睡眠监测测量：每晚睡眠 6 小时或更少的人，感染感冒的风险是睡 7 小时以上者的 4 倍以上。",
    url: "https://www.eurekalert.org/news-releases/804618",
  },
  williamson2000: {
    label: "Williamson AM & Feyer AM, Occup Environ Med, 2000",
    finding: "连续保持清醒 17 小时，手眼协调与反应能力的下降程度相当于血液酒精浓度 0.05%；连续 24 小时则相当于 0.10%。",
    url: "https://pubmed.ncbi.nlm.nih.gov/10984335/",
  },
  iarc2019: {
    label: "IARC 专著第 124 卷，2019",
    finding: "世界卫生组织下属国际癌症研究机构将「涉及昼夜节律紊乱的轮班工作」列为 2A 类，即很可能对人类致癌。",
    url: "https://publications.iarc.who.int/Book-And-Report-Series/Iarc-Monographs-On-The-Identification-Of-Carcinogenic-Hazards-To-Humans/Night-Shift-Work-2019",
  },
  xie2013: {
    label: "Xie L et al., Science, 2013",
    finding: "动物实验显示，睡眠期间脑内类淋巴系统的代谢废物清除效率显著高于清醒状态，其中包括与阿尔茨海默病相关的 β-淀粉样蛋白。",
    url: "https://www.science.org/doi/10.1126/science.1241224",
  },
  yoo2007: {
    label: "Yoo SS et al., Current Biology, 2007",
    finding: "一夜不睡后，大脑前额叶对杏仁核的调控明显减弱，情绪反应被放大——这解释了为什么熬夜时更容易烦躁和冲动。",
    url: "https://www.cell.com/current-biology/fulltext/S0960-9822(07)01796-7",
  },
};

/** 危害科普条目 */
const HAZARDS = [
  { id: "h-cold", kind: "hazard", source: "prather2015", text: "每晚睡不够 6 小时的人，感冒风险是睡够 7 小时者的 4 倍以上。" },
  { id: "h-alcohol", kind: "hazard", source: "williamson2000", text: "清醒 17 小时后，你的反应速度大约相当于血液酒精浓度 0.05% 的状态。" },
  { id: "h-alcohol24", kind: "hazard", source: "williamson2000", text: "连续清醒 24 小时，认知表现约等于血液酒精浓度 0.10%——多数地区的醉驾标准。" },
  { id: "h-iarc", kind: "hazard", source: "iarc2019", text: "世卫组织下属机构已将「昼夜节律紊乱的轮班工作」列为 2A 类致癌因素。" },
  { id: "h-glymphatic", kind: "hazard", source: "xie2013", text: "大脑主要在睡眠中清理代谢废物，包括与阿尔茨海默病相关的 β-淀粉样蛋白。" },
  { id: "h-amygdala", kind: "hazard", source: "yoo2007", text: "缺觉会让前额叶管不住情绪中枢，所以熬夜时人更容易烦躁、更容易冲动下单。" },
  { id: "h-vicious", kind: "hazard", text: "刷手机带来的即时快感会推迟困意，睡得更晚，第二天更疲惫——这是一个会自我强化的循环。" },
  { id: "h-blue", kind: "hazard", text: "屏幕蓝光会抑制褪黑素分泌，让身体误以为天还没黑。" },
];

/** 通用安抚语句 */
const COMFORT = [
  { id: "c-1", kind: "comfort", text: "今天已经结束了。剩下的事，明天再说也来得及。" },
  { id: "c-2", kind: "comfort", text: "放下手机不是惩罚，是把时间还给明天的自己。" },
  { id: "c-3", kind: "comfort", text: "屏幕之外没有错过什么，你只是需要休息。" },
  { id: "c-4", kind: "comfort", text: "现在闭眼，是今天最容易做到、也最划算的一件事。" },
  { id: "c-5", kind: "comfort", text: "不用强迫自己马上睡着，躺着、闭眼、慢呼吸就够了。" },
  { id: "c-6", kind: "comfort", text: "你已经坚持到了这个时间，剩下的交给身体自己。" },
  { id: "c-7", kind: "comfort", text: "深呼吸三次。吸气四秒，屏息两秒，呼气六秒。" },
  { id: "c-8", kind: "comfort", text: "夜里想不明白的事，早上往往就没那么重了。" },
  { id: "c-9", kind: "comfort", text: "这不是自律的失败，只是一次需要被帮助的坚持。" },
  { id: "c-10", kind: "comfort", text: "灯已经关了。现在，只需要闭上眼睛。" },
];

/** 场景专属文案 */
const SCENE_COPY = {
  [SCENE.FRIDAY_NIGHT]: [
    { id: "f-1", kind: "scene", text: "明天就是周末了，今晚睡个好觉，周末才有力气好好放松。" },
    { id: "f-2", kind: "scene", text: "周五晚最容易报复性熬夜——但周末补觉，补不回失去的深睡。" },
    { id: "f-3", kind: "scene", text: "周末的第一份礼物，是一个不用定闹钟的早晨。前提是今晚得睡着。" },
  ],
  [SCENE.SATURDAY_NIGHT]: [
    { id: "s-1", kind: "scene", text: "周六晚放松得刚刚好，别把作息一口气推到明天凌晨。" },
    { id: "s-2", kind: "scene", text: "明天还能休息，所以今晚更值得睡饱。" },
  ],
  [SCENE.SUNDAY_NIGHT]: [
    { id: "s-3", kind: "scene", text: "周日晚的焦虑，多半是缺觉放大的。先睡，明天再面对。" },
    { id: "s-4", kind: "scene", text: "明天要上班，今晚的每一分钟睡眠都在替明天省力。" },
    { id: "s-5", kind: "scene", text: "周一不会因为今晚少睡两小时而变轻松，只会更难。" },
  ],
  [SCENE.HOLIDAY_EVE]: [
    { id: "he-1", kind: "scene", text: "假期前夜，明天可以睡到自然醒，但今晚不必熬到那么晚。" },
    { id: "he-2", kind: "scene", text: "假期最好的打开方式，是先睡饱再出发。" },
    { id: "he-3", kind: "scene", text: "期待明天的心情很好，带着它去睡觉吧。" },
  ],
  [SCENE.HOLIDAY]: [
    { id: "hd-1", kind: "scene", text: "假期里也别把作息彻底颠倒，回到工作日会更难受。" },
    { id: "hd-2", kind: "scene", text: "休息的意义是恢复，不是把生物钟拆掉重装。" },
  ],
  [SCENE.HOLIDAY_LAST_NIGHT]: [
    { id: "hl-1", kind: "scene", text: "这是假期的最后一晚，今晚睡好，明天收心会轻松很多。" },
    { id: "hl-2", kind: "scene", text: "假期余额不足了。今晚早睡，是给自己留的缓冲。" },
    { id: "hl-3", kind: "scene", text: "明天要回到节奏里，今晚提前一晚调整，比明天硬撑舒服得多。" },
  ],
  [SCENE.MAKEUP_WORKDAY_NIGHT]: [
    { id: "mw-1", kind: "scene", text: "今天是为假期补班的调休日，辛苦了，今晚别再多熬。" },
  ],
  [SCENE.ORDINARY]: [
    { id: "o-1", kind: "scene", text: "明天是普通的一天，而今晚的睡眠决定了它的质量。" },
    { id: "o-2", kind: "scene", text: "工作日晚上，早睡一小时，白天多出两小时的清醒。" },
  ],
};

/** 直接按场景取文案（节日祝福会动态插入） */
export function sceneEntries(scene) {
  const entries = [];

  if (scene.holidayToday) {
    const name = scene.holidayToday;
    if (scene.isHolidayLastNight) {
      entries.push({ id: `hg-last-${name}`, kind: "greeting", text: `${name}假期就要结束了，今晚好好收个尾。` });
    } else {
      entries.push({ id: `hg-${name}`, kind: "greeting", text: `${name}快乐。假期里也要睡够。` });
    }
  }
  if (scene.isHolidayEve && scene.holidayTomorrow) {
    const name = scene.holidayTomorrow;
    entries.push({ id: `hg-eve-${name}`, kind: "greeting", text: `明天就是${name}了，今晚睡个好觉，假期好好放松。` });
  }

  entries.push(...(SCENE_COPY[scene.scene] ?? []));
  return entries;
}

/** mulberry32：小巧、确定性好的伪随机数发生器，便于测试复现 */
export function createRandom(seed = 1) {
  let state = seed >>> 0;
  return function random() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(items, random) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * 组装播放列表：危害科普与安抚语句交替，场景专属语句靠前。
 * 交替而非混排，是为了避免连续两条科普造成"被说教"的压迫感（PRD 4.1 极简克制）。
 */
export function buildPlaylist(scene, options = {}) {
  const { seed = hashString(scene.dateKey + scene.scene), includeHazards = true } = options;
  const random = createRandom(seed);

  const sceneSpecific = sceneEntries(scene);
  const hazards = includeHazards ? shuffle(HAZARDS, random) : [];
  const comfort = shuffle(COMFORT, random);

  const playlist = [];
  // 开场先给场景专属语句：让用户立刻感到"它知道今天是什么日子"
  playlist.push(...sceneSpecific);
  playlist.push(...comfort.splice(0, 2));

  const maxLength = Math.max(hazards.length, comfort.length);
  for (let i = 0; i < maxLength; i += 1) {
    if (hazards[i]) playlist.push(hazards[i]);
    if (comfort[i]) playlist.push(comfort[i]);
  }
  return playlist;
}

/** 稳定字符串哈希，用于给每天的播放顺序定种子（同一天刷新顺序一致） */
export function hashString(input) {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * 轮播器。`next()` 返回下一条，走到末尾自动从头开始（而不是重新洗牌，
 * 避免用户察觉"顺序变了"）。
 */
export function createRotator({ entries, intervalMs = 12_000, startIndex = 0 }) {
  if (!entries?.length) throw new RangeError("轮播文案列表不能为空");
  let index = ((startIndex % entries.length) + entries.length) % entries.length;
  return {
    get intervalMs() {
      return intervalMs;
    },
    get length() {
      return entries.length;
    },
    current() {
      return entries[index];
    },
    next() {
      index = (index + 1) % entries.length;
      return entries[index];
    },
    /** 跳到指定 id 的条目；找不到则保持不动 */
    jumpTo(id) {
      const found = entries.findIndex((entry) => entry.id === id);
      if (found >= 0) index = found;
      return entries[index];
    },
  };
}

export const HAZARD_COUNT = HAZARDS.length;
export const COMFORT_COUNT = COMFORT.length;
export { HAZARDS, COMFORT, SCENE_COPY };
