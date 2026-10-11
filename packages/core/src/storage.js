/**
 * 熄灯早睡 · 存储适配层
 *
 * PRD 六、非功能需求："所有设置数据本地存储，不上传用户隐私"。
 * 因此这里只做本机持久化，且**读取永远不能抛异常**——存储损坏时必须回退到默认值，
 * 否则用户会卡在莫名其妙的白屏里。
 *
 * 该适配层同时让核心逻辑可以在 Node（测试）与桌面端（文件存储）复用。
 */

/** 进程内存储，作为 localStorage 不可用时的兜底（隐私模式、Node 测试） */
export function createMemoryStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
    removeItem(key) {
      map.delete(key);
    },
    clear() {
      map.clear();
    },
    key(index) {
      return [...map.keys()][index] ?? null;
    },
    get length() {
      return map.size;
    },
    /** 便于测试断言 */
    _dump() {
      return Object.fromEntries(map);
    },
  };
}

/** 判断一个对象是否满足 Web Storage 接口 */
export function isStorageLike(candidate) {
  return Boolean(
    candidate &&
      typeof candidate.getItem === "function" &&
      typeof candidate.setItem === "function" &&
      typeof candidate.removeItem === "function",
  );
}

/**
 * 解析可用的存储：优先用调用方给的（localStorage），不可用时退回内存实现。
 * 浏览器在无痕模式或存储配额耗尽时，访问 localStorage 本身就会抛异常，所以必须 try/catch。
 */
export function resolveStorage(candidate) {
  try {
    if (isStorageLike(candidate)) {
      const probeKey = "__xideng_probe__";
      candidate.setItem(probeKey, "1");
      candidate.removeItem(probeKey);
      return candidate;
    }
  } catch {
    /* 落回内存存储 */
  }
  return createMemoryStorage();
}

/** 数组整体替换、对象递归合并的深合并 */
export function deepMerge(base, patch) {
  if (patch === undefined) return clone(base);
  if (patch === null || typeof patch !== "object" || Array.isArray(patch)) return clone(patch);
  if (typeof base !== "object" || base === null || Array.isArray(base)) return clone(patch);

  const result = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    result[key] = deepMerge(base[key], value);
  }
  return result;
}

export function clone(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(clone);
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clone(v)]));
}

/**
 * 带默认值与命名空间的键值存储。
 * @param {{storage: object, key: string, defaults: object}} options
 */
export function createStore({ storage, key, defaults }) {
  function read() {
    try {
      const raw = storage.getItem(key);
      if (!raw) return clone(defaults);
      const parsed = JSON.parse(raw);
      return deepMerge(defaults, parsed);
    } catch {
      // 数据损坏 → 用默认值覆盖，保证应用始终能启动
      try {
        storage.removeItem(key);
      } catch {
        /* 忽略 */
      }
      return clone(defaults);
    }
  }

  function write(value) {
    try {
      storage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }

  return {
    key,
    read,
    write,
    /** 合并式更新，返回新值 */
    patch(partial) {
      const next = deepMerge(read(), partial);
      write(next);
      return next;
    },
    reset() {
      const fresh = clone(defaults);
      write(fresh);
      return fresh;
    },
    clear() {
      try {
        storage.removeItem(key);
      } catch {
        /* 忽略 */
      }
    },
  };
}
