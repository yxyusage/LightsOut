/**
 * 熄灯早睡 · 紧急解除密码
 *
 * 定位说明（请勿误读为安全机制）：PRD 2.2.5 的密码是**防冲动的一次减速带**，
 * 挡住的是"半夜手滑想退出"的瞬时决定，不是攻击者。密码哈希与全部设置一样
 * 只存在用户本机，本应用不获取、不上传（PRD 六、隐私安全）。
 *
 * 因此这里使用固定的域分隔前缀 + SHA-256，而**不做**慢哈希/KDF：
 * 引入盐值存储与迭代参数只会增加复杂度，却挡不住能读 localStorage 的人。
 * 这个取舍是有意为之，已在文档中说明。
 */

const DOMAIN_PREFIX = "xideng::emergency::v1";

/** 无 WebCrypto 环境（极老的运行时）下的确定性兜底哈希——强度弱，仅保证可用 */
function fallbackHash(input) {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 16777619) >>> 0;
    h2 = Math.imul(h2 + code, 2246822519) >>> 0;
  }
  return `fallback${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}`;
}

/**
 * 计算密码摘要。
 * @param {string} password
 * @returns {Promise<string>} 十六进制摘要
 */
export async function hashPassword(password) {
  const payload = `${DOMAIN_PREFIX}|${String(password ?? "")}`;
  const subtle = globalThis.crypto?.subtle;
  if (subtle && typeof TextEncoder !== "undefined") {
    const bytes = new TextEncoder().encode(payload);
    const digest = await subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  return fallbackHash(payload);
}

/**
 * 校验密码。
 * @param {string} password
 * @param {string} expectedHash 空字符串表示尚未设置密码
 */
export async function verifyPassword(password, expectedHash) {
  if (!expectedHash) return false;
  const actual = await hashPassword(password);
  // 逐字符比较，避免提前返回造成的时长差异（此处收益有限，但成本同样极低）
  if (actual.length !== expectedHash.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i += 1) diff |= actual.charCodeAt(i) ^ expectedHash.charCodeAt(i);
  return diff === 0;
}

/** 密码强度提示，用于首次引导界面（返回人类可读的建议，空数组表示合格） */
export function passwordAdvice(password) {
  const text = String(password ?? "");
  const advice = [];
  if (text.length < 4) advice.push("至少 4 位");
  if (/^\d+$/.test(text)) advice.push("纯数字容易误触通过，建议混合字母");
  if (text.length > 32) advice.push("不要超过 32 位，以免难以输入");
  return advice;
}
