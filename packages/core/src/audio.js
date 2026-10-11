/**
 * 熄灯早睡 · 助眠白噪音（PRD 2.3）
 *
 * 五类音色全部用 Web Audio API **实时合成**，不加载任何音频文件。这样做有三个好处：
 *  1. 零版权风险 —— 赛事要求参赛素材必须享有合法权利，合成音没有这个问题；
 *  2. 零体积 —— 整个应用仍然可以离线跑，不需要几百 KB 的 mp3；
 *  3. 可无限循环不露接缝 —— 噪声缓冲区天然无缝，不像采样音频有循环点。
 *
 * 音色设计：
 *  - 雨声   白噪声 → 高通 900Hz + 低通 7kHz，加 0.15Hz 的缓慢起伏模拟雨势变化
 *  - 海浪声 布朗噪声 → 低通 700Hz，0.08Hz 正弦 LFO 调制音量，另有 0.05Hz 扫描截止频率形成潮汐涌动
 *  - 溪流声 白噪声 → 高通 500Hz + 带通 1.8kHz，0.4Hz 轻微调制中心频率
 *  - 篝火声 布朗噪声 → 低通 500Hz 打底，叠加随机的高频爆裂脉冲
 *  - 白噪音 纯白噪声 → 轻微衰减，作为最"中性"的遮蔽音
 */

export const AUDIO_PRESETS = [
  { id: "rain", name: "雨声", description: "绵密稳定，适合盖住环境杂音" },
  { id: "stream", name: "溪流声", description: "明亮流动，帮助放松注意力" },
  { id: "waves", name: "海浪声", description: "缓慢起伏，接近呼吸的节奏" },
  { id: "campfire", name: "篝火声", description: "低频温暖，夹着细碎爆裂声" },
  { id: "white", name: "纯白噪音", description: "最中性的遮蔽音，不引导情绪" },
];

/** PRD 2.3：可选 15 / 30 / 60 分钟，或持续播放至熄灯结束（用 0 表示） */
export const AUDIO_DURATION_OPTIONS = [
  { minutes: 15, label: "15 分钟" },
  { minutes: 30, label: "30 分钟" },
  { minutes: 60, label: "60 分钟" },
  { minutes: 0, label: "持续播放至熄灯结束" },
];

export function isAudioPreset(id) {
  return AUDIO_PRESETS.some((preset) => preset.id === id);
}

/**
 * 生成噪声采样。纯函数 + 可注入随机源，因此可以在 Node 里做统计性质验证。
 *
 * @param {{length: number, type?: "white"|"pink"|"brown", random?: () => number}} options
 * @returns {Float32Array} 取值约在 [-1, 1]
 */
export function generateNoiseSamples({ length, type = "white", random = Math.random }) {
  if (!Number.isInteger(length) || length <= 0) throw new RangeError("length 必须是正整数");
  const samples = new Float32Array(length);

  if (type === "brown") {
    // 布朗噪声：对白噪声做泄漏积分，能量集中在低频，听感接近远处的水流与风声
    let last = 0;
    for (let i = 0; i < length; i += 1) {
      const white = random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      samples[i] = last * 3.5;
    }
    return samples;
  }

  if (type === "pink") {
    // Paul Kellet 的经典近似实现：-3dB/倍频程，比白噪声柔和不刺耳
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    let b3 = 0;
    let b4 = 0;
    let b5 = 0;
    let b6 = 0;
    for (let i = 0; i < length; i += 1) {
      const white = random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.969 * b2 + white * 0.153852;
      b3 = 0.8665 * b3 + white * 0.3104856;
      b4 = 0.55 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.016898;
      samples[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
      b6 = white * 0.115926;
    }
    return samples;
  }

  for (let i = 0; i < length; i += 1) samples[i] = random() * 2 - 1;
  return samples;
}

/** 把噪声采样包装成可循环播放的 AudioBuffer */
export function createNoiseBuffer(context, { seconds = 4, type = "white", random = Math.random } = {}) {
  const length = Math.max(1, Math.floor(context.sampleRate * seconds));
  const buffer = context.createBuffer(1, length, context.sampleRate);
  buffer.copyToChannel(generateNoiseSamples({ length, type, random }), 0);
  return buffer;
}

/**
 * 构建某个音色的音频图。
 * @returns {{start: Function, stop: Function}} 由调用方负责调度
 */
export function buildAudioGraph(context, presetId, destination, random = Math.random) {
  const master = context.createGain();
  master.gain.value = 1;
  master.connect(destination);

  const sources = [];
  const timers = [];

  function loopSource(type, seconds = 4) {
    const source = context.createBufferSource();
    source.buffer = createNoiseBuffer(context, { seconds, type, random });
    source.loop = true;
    return source;
  }

  function addLfo({ frequency, depth, target, type = "sine" }) {
    const lfo = context.createOscillator();
    lfo.type = type;
    lfo.frequency.value = frequency;
    const depthGain = context.createGain();
    depthGain.gain.value = depth;
    lfo.connect(depthGain).connect(target);
    lfo.start();
    sources.push(lfo);
    return lfo;
  }

  switch (presetId) {
    case "white": {
      const source = loopSource("white");
      const gain = context.createGain();
      gain.gain.value = 0.28;
      source.connect(gain).connect(master);
      sources.push(source);
      break;
    }

    case "rain": {
      const source = loopSource("white");
      const highpass = context.createBiquadFilter();
      highpass.type = "highpass";
      highpass.frequency.value = 900;
      const lowpass = context.createBiquadFilter();
      lowpass.type = "lowpass";
      lowpass.frequency.value = 7000;
      const gain = context.createGain();
      gain.gain.value = 0.22;
      source.connect(highpass).connect(lowpass).connect(gain).connect(master);
      addLfo({ frequency: 0.15, depth: 0.05, target: gain.gain });
      sources.push(source);
      break;
    }

    case "stream": {
      const source = loopSource("white", 5);
      const highpass = context.createBiquadFilter();
      highpass.type = "highpass";
      highpass.frequency.value = 500;
      const bandpass = context.createBiquadFilter();
      bandpass.type = "bandpass";
      bandpass.frequency.value = 1800;
      bandpass.Q.value = 0.6;
      const gain = context.createGain();
      gain.gain.value = 0.24;
      source.connect(highpass).connect(bandpass).connect(gain).connect(master);
      addLfo({ frequency: 0.4, depth: 400, target: bandpass.frequency });
      sources.push(source);
      break;
    }

    case "waves": {
      const source = loopSource("brown", 6);
      const lowpass = context.createBiquadFilter();
      lowpass.type = "lowpass";
      lowpass.frequency.value = 700;
      const gain = context.createGain();
      gain.gain.value = 0.3;
      source.connect(lowpass).connect(gain).connect(master);
      // 0.08Hz ≈ 12.5 秒一个周期，接近一次深呼吸到潮汐的节奏
      addLfo({ frequency: 0.08, depth: 0.22, target: gain.gain });
      addLfo({ frequency: 0.05, depth: 250, target: lowpass.frequency });
      sources.push(source);
      break;
    }

    case "campfire": {
      const source = loopSource("brown", 5);
      const lowpass = context.createBiquadFilter();
      lowpass.type = "lowpass";
      lowpass.frequency.value = 500;
      const gain = context.createGain();
      gain.gain.value = 0.26;
      source.connect(lowpass).connect(gain).connect(master);
      sources.push(source);

      // 随机爆裂脉冲：真实的篝火是不规则的，用随机间隔比等间隔更耐听
      const scheduleCrackle = () => {
        const delay = 120 + random() * 900;
        const timer = setTimeout(() => {
          const burst = loopSource("white", 0.08);
          burst.loop = false;
          const bandpass = context.createBiquadFilter();
          bandpass.type = "bandpass";
          bandpass.frequency.value = 1500 + random() * 2500;
          bandpass.Q.value = 1.2;
          const burstGain = context.createGain();
          const now = context.currentTime;
          burstGain.gain.setValueAtTime(0, now);
          burstGain.gain.linearRampToValueAtTime(0.06 + random() * 0.1, now + 0.004);
          burstGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.06);
          burst.connect(bandpass).connect(burstGain).connect(master);
          burst.start(now);
          burst.stop(now + 0.1);
          scheduleCrackle();
        }, delay);
        timers.push(timer);
      };
      scheduleCrackle();
      break;
    }

    default:
      throw new RangeError(`未知的音色：${presetId}`);
  }

  return {
    start() {
      for (const source of sources) {
        if (typeof source.start === "function" && !source.__started) {
          source.start();
          source.__started = true;
        }
      }
    },
    stop() {
      for (const timer of timers) clearTimeout(timer);
      timers.length = 0;
      for (const source of sources) {
        try {
          source.stop?.();
        } catch {
          /* 已经停止 */
        }
      }
    },
    node: master,
  };
}

/**
 * 音频引擎。所有失败都降级为"静默不可用"，绝不让音频问题影响熄灯流程。
 */
export function createAudioEngine(options = {}) {
  const {
    createContext = () => {
      const Ctor = globalThis.AudioContext ?? globalThis.webkitAudioContext;
      return Ctor ? new Ctor() : null;
    },
  } = options;

  let context = null;
  let masterGain = null;
  let graph = null;
  let currentId = null;
  let volume = 0.6;
  let stopTimer = null;

  async function ensureContext() {
    if (!context) {
      context = createContext();
      if (!context) return null;
      masterGain = context.createGain();
      masterGain.gain.value = volume;
      masterGain.connect(context.destination);
    }
    // 浏览器要求音频在用户手势后才能开始播放
    if (context.state === "suspended") await context.resume();
    return context;
  }

  function clearStopTimer() {
    if (stopTimer !== null) {
      clearTimeout(stopTimer);
      stopTimer = null;
    }
  }

  function teardown(fadeMs) {
    const dying = graph;
    const dyingGain = masterGain;
    graph = null;
    currentId = null;
    clearStopTimer();
    if (!dying || !context) return;

    if (fadeMs > 0 && dyingGain) {
      const now = context.currentTime;
      dyingGain.gain.cancelScheduledValues(now);
      dyingGain.gain.setValueAtTime(dyingGain.gain.value, now);
      dyingGain.gain.linearRampToValueAtTime(0.0001, now + fadeMs / 1000);
      setTimeout(() => dying.stop(), fadeMs + 60);
    } else {
      dying.stop();
    }
  }

  return {
    /** 运行环境是否具备音频能力 */
    get supported() {
      return Boolean(globalThis.AudioContext ?? globalThis.webkitAudioContext) || typeof options.createContext === "function";
    },

    get isPlaying() {
      return currentId !== null;
    },

    get current() {
      return currentId;
    },

    get volume() {
      return volume;
    },

    /**
     * 播放指定音色。
     * @param {string} presetId
     * @param {{durationMs?: number}} [opts] durationMs 为 0 表示持续播放
     */
    async play(presetId, { durationMs = 0 } = {}) {
      if (!isAudioPreset(presetId)) return { ok: false, reason: "unknown-preset" };
      const ctx = await ensureContext();
      if (!ctx) return { ok: false, reason: "unsupported" };

      teardown(0);

      graph = buildAudioGraph(ctx, presetId, masterGain);
      currentId = presetId;

      const now = ctx.currentTime;
      masterGain.gain.cancelScheduledValues(now);
      masterGain.gain.setValueAtTime(0.0001, now);
      masterGain.gain.linearRampToValueAtTime(volume, now + 0.8);
      graph.start();

      if (durationMs > 0) {
        stopTimer = setTimeout(() => {
          stopTimer = null;
          this.stop();
        }, durationMs);
      }
      return { ok: true, preset: presetId };
    },

    stop({ fadeMs = 500 } = {}) {
      teardown(fadeMs);
    },

    setVolume(next) {
      volume = Math.min(1, Math.max(0, Number(next) || 0));
      if (masterGain && context && currentId) {
        const now = context.currentTime;
        masterGain.gain.cancelScheduledValues(now);
        masterGain.gain.setValueAtTime(masterGain.gain.value, now);
        masterGain.gain.linearRampToValueAtTime(volume, now + 0.15);
      }
      return volume;
    },

    dispose() {
      teardown(0);
      try {
        masterGain?.disconnect();
        context?.close?.();
      } catch {
        /* 忽略 */
      }
      context = null;
      masterGain = null;
    },
  };
}
