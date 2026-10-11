/**
 * 熄灯早睡 · AI 场景化文案（PRD 2.4）
 *
 * 两条路径共用同一份场景事实：
 *  - 未配置 API Key → 走 `copy.js` 的本地文案库，功能完整、零网络请求；
 *  - 已配置 API Key → 调用用户自己的 OpenAI 兼容接口生成个性化文案。
 *
 * 三条硬约束：
 *  1. **API Key 只存在用户本机**，随请求发往用户自己填写的 baseUrl，不经过任何第三方中转；
 *  2. 只有结构化场景事实进入提示词，不发送通讯录、使用记录等任何隐私数据；
 *  3. 任何失败（网络、限流、超时、格式错误）都静默退回本地文案库，绝不阻断熄灯流程。
 */

import { describeScene } from "./scene.js";

export const AI_SYSTEM_PROMPT = [
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
].join("\n");

/**
 * 构造 OpenAI 兼容的 messages 数组。
 * @param {object} scene `detectScene()` 的结果
 */
export function buildMessages(scene) {
  return [
    { role: "system", content: AI_SYSTEM_PROMPT },
    {
      role: "user",
      content: `请根据以下情况写一句睡前文案：\n${describeScene(scene)}\n\n直接输出这一句话。`,
    },
  ];
}

/** 清洗模型输出：去掉引号/前缀/多余空白，并限制长度 */
export function sanitizeCopy(raw, maxLength = 60) {
  if (typeof raw !== "string") return "";
  let text = raw.trim();

  // 去掉模型常见的"文案："式前缀
  text = text.replace(/^(文案|输出|回答|句子)\s*[:：]\s*/u, "");
  // 去掉包裹的引号（含中文引号）
  text = text.replace(/^[「『"'“”‘’]+|[」』"'“”‘’]+$/gu, "");
  // 折叠换行与多余空格，只保留第一句以外的部分会被截断
  text = text.replace(/\s*\n+\s*/g, " ").replace(/\s{2,}/g, " ").trim();
  // 只取第一个句子，避免模型输出一段话
  const sentenceEnd = text.search(/[。！？!?]/u);
  if (sentenceEnd >= 0 && sentenceEnd + 1 <= maxLength) text = text.slice(0, sentenceEnd + 1);

  if (text.length > maxLength) text = `${text.slice(0, maxLength - 1)}…`;
  return text.trim();
}

/**
 * 创建 AI 客户端。
 *
 * @param {{
 *   getConfig?: () => object,
 *   cache?: {getItem: Function, setItem: Function} | null,
 *   fetchImpl?: Function,
 *   cacheKey?: string,
 *   maxCacheEntries?: number
 * }} [options]
 */
export function createAIClient(options = {}) {
  const {
    getConfig = () => ({ enabled: false, apiKey: "" }),
    cache = null,
    fetchImpl = globalThis.fetch,
    cacheKey = "xideng.ai.cache.v1",
    maxCacheEntries = 60,
  } = options;

  function readCache() {
    if (!cache) return {};
    try {
      const parsed = JSON.parse(cache.getItem(cacheKey) ?? "{}");
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  function writeCache(entries) {
    if (!cache) return;
    try {
      // 按插入顺序淘汰，保留最近的 N 条
      const keys = Object.keys(entries);
      const trimmed = keys.length > maxCacheEntries ? Object.fromEntries(keys.slice(-maxCacheEntries).map((k) => [k, entries[k]])) : entries;
      cache.setItem(cacheKey, JSON.stringify(trimmed));
    } catch {
      /* 缓存失败无影响 */
    }
  }

  /** 缓存键：同一天、同一场景、同一节假日上下文只请求一次 */
  function cacheKeyFor(scene) {
    return `${scene.dateKey}|${scene.scene}|${scene.holidayToday ?? ""}|${scene.holidayTomorrow ?? ""}`;
  }

  return {
    /** 是否具备调用条件（已启用 + 已填 Key + 已填模型） */
    get available() {
      const config = getConfig();
      return Boolean(config?.enabled && config?.apiKey && config?.model && fetchImpl);
    },

    /**
     * 生成一句场景化文案。
     * @returns {Promise<{ok: true, text: string, cached: boolean} | {ok: false, reason: string}>}
     */
    async generate(scene, { signal } = {}) {
      const config = getConfig();
      if (!config?.enabled) return { ok: false, reason: "disabled" };
      if (!config?.apiKey) return { ok: false, reason: "no-api-key" };
      if (!fetchImpl) return { ok: false, reason: "fetch-unavailable" };

      const key = cacheKeyFor(scene);
      const cached = readCache();
      if (cached[key]) return { ok: true, text: cached[key], cached: true };

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.timeoutMs ?? 12_000);
      // 外部 signal 与超时 controller 联动，任一触发都中止请求
      const onExternalAbort = () => controller.abort();
      signal?.addEventListener?.("abort", onExternalAbort, { once: true });

      try {
        const response = await fetchImpl(`${config.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify({
            model: config.model,
            temperature: config.temperature ?? 0.9,
            max_tokens: 120,
            messages: buildMessages(scene),
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          // 只回传状态码，绝不把响应体或 Key 写进日志
          return { ok: false, reason: `http-${response.status}` };
        }

        const payload = await response.json();
        const text = sanitizeCopy(payload?.choices?.[0]?.message?.content ?? "");
        if (!text) return { ok: false, reason: "empty-response" };

        const entries = readCache();
        entries[key] = text;
        writeCache(entries);
        return { ok: true, text, cached: false };
      } catch (error) {
        return { ok: false, reason: error?.name === "AbortError" ? "timeout" : "network" };
      } finally {
        clearTimeout(timeout);
        signal?.removeEventListener?.("abort", onExternalAbort);
      }
    },

    clearCache() {
      try {
        cache?.removeItem?.(cacheKey);
      } catch {
        /* 忽略 */
      }
    },

    /** 让设置页能显示"待请求 / 已缓存"条数 */
    cacheSize() {
      return Object.keys(readCache()).length;
    },
  };
}
