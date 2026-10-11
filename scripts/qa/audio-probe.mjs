/**
 * 音频能力探针：逐个音色测量**实际输出电平**（RMS），找出"播放不出来"的是哪几个。
 *
 * 做法：在页面脚本执行前注入钩子，监听"谁连接到了 AudioContext.destination"，
 * 并在那个节点上并联一个 AnalyserNode。这样测到的是真正流向扬声器的信号，
 * 而不是"代码看起来应该出声"。
 *
 * 同时覆盖真实用户路径：连续切换音色（不停再播），这正是最容易出问题的地方。
 */
import { writeFile, mkdir } from "node:fs/promises";

const CDP = "http://127.0.0.1:9222";
const APP = process.argv[2];
const OUT = process.argv[3] || ".";
const PRESETS = ["white", "rain", "stream", "waves", "campfire"];
const LABEL = { white: "纯白噪音", rain: "雨声", stream: "溪流声", waves: "海浪声", campfire: "篝火声" };

await mkdir(OUT, { recursive: true });

const target = await (await fetch(`${CDP}/json/new?about:blank`, { method: "PUT" })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();

function send(method, params = {}) {
  const messageId = ++id;
  ws.send(JSON.stringify({ id: messageId, method, params }));
  return new Promise((resolve, reject) => pending.set(messageId, { resolve, reject }));
}
async function evaluate(expression) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + " " + (r.exceptionDetails.exception?.description ?? ""));
  return r.result.value;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await new Promise((res, rej) => {
  ws.addEventListener("open", res, { once: true });
  ws.addEventListener("error", rej, { once: true });
});
ws.addEventListener("message", (event) => {
  const m = JSON.parse(event.data);
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
  }
});

await send("Page.enable");
await send("Runtime.enable");

// 注入探针：谁连到 destination，就在它上面并联一个分析器
await send("Page.addScriptToEvaluateOnNewDocument", {
  source: `(function () {
    if (!window.AudioNode) return;
    var origConnect = AudioNode.prototype.connect;
    window.__xidengTaps = [];
    AudioNode.prototype.connect = function (dest) {
      var rest = Array.prototype.slice.call(arguments, 1);
      var result = origConnect.apply(this, [dest].concat(rest));
      try {
        var ctx = this.context;
        if (dest === ctx.destination && !this.__xidengTapped) {
          this.__xidengTapped = true;
          var analyser = ctx.createAnalyser();
          analyser.fftSize = 2048;
          origConnect.call(this, analyser);
          window.__xidengTaps.push(analyser);
        }
      } catch (e) { window.__xidengTapError = String(e); }
      return result;
    };
  })();`,
});

await send("Emulation.setDeviceMetricsOverride", { width: 430, height: 932, deviceScaleFactor: 2, mobile: true });
await send("Page.navigate", { url: APP });
await sleep(3200);

// 直接进演示熄灯模式，这样音频入口可用
await evaluate("window.__xideng.actions.startDemo()");
await sleep(2200);

const ctxInfo = await evaluate(`(function(){
  var taps = window.__xidengTaps || [];
  var ctx = taps[0] ? taps[0].context : null;
  return JSON.stringify({
    taps: taps.length,
    tapError: window.__xidengTapError || null,
    ctxState: ctx ? ctx.state : null,
    sampleRate: ctx ? ctx.sampleRate : null,
    currentTime: ctx ? Number(ctx.currentTime.toFixed(2)) : null
  });
})()`);
console.log("  AudioContext:", ctxInfo);

const measureRms = () => evaluate(`(function(){
  var taps = window.__xidengTaps || [];
  var best = 0;
  for (var i = 0; i < taps.length; i++) {
    var buf = new Float32Array(taps[i].fftSize);
    taps[i].getFloatTimeDomainData(buf);
    var sum = 0;
    for (var j = 0; j < buf.length; j++) sum += buf[j] * buf[j];
    var rms = Math.sqrt(sum / buf.length);
    if (rms > best) best = rms;
  }
  return best;
})()`);

async function sampleWhilePlaying(ms, samples = 6) {
  let peak = 0;
  const series = [];
  for (let i = 0; i < samples; i += 1) {
    await sleep(ms / samples);
    const v = await measureRms();
    series.push(v);
    if (v > peak) peak = v;
  }
  return { peak, series };
}

/** 单个音色出错不应中断整轮，否则后面的音色永远测不到 */
async function safety(fn) {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    return { ok: false, error: String(error.message || error).split("\n")[0] };
  }
}

const results = [];

console.log("");
console.log("  ── A. 逐个音色（每次都先停止再播放）──");
for (const preset of PRESETS) {
  const attempt = await safety(async () => {
    await evaluate("window.__xideng.audio.stop()");
    await sleep(400);
    await evaluate(`window.__xideng.actions.setAudioPreset("${preset}")`);
    await evaluate("window.__xideng.actions.toggleAudio()");
    await sleep(1300);
    const { peak, series } = await sampleWhilePlaying(1200);
    const state = await evaluate("JSON.stringify({playing: window.__xideng.audio.isPlaying, current: window.__xideng.audio.current, ctx: (window.__xidengTaps[0]||{}).context ? window.__xidengTaps[0].context.state : null})");
    return { peak, series, state };
  });
  if (!attempt.ok) {
    console.log(`    报错 ✗  ${LABEL[preset].padEnd(6)} ${attempt.error}`);
    results.push({ preset, mode: "fresh", peak: 0, error: attempt.error });
    continue;
  }
  const { peak, series, state } = attempt.value;
  const ok = peak > 0.005;
  console.log(`    ${ok ? "有声" : "静音 ✗"}  ${LABEL[preset].padEnd(6)} peak RMS = ${peak.toFixed(5)}   ${state}`);
  results.push({ preset, mode: "fresh", peak, state, series });
}

console.log("");
console.log("  ── B. 连续切换（不停再播，真实用户路径）──");
for (const preset of PRESETS) {
  const attempt = await safety(async () => {
    await evaluate(`window.__xideng.actions.setAudioPreset("${preset}")`);
    await sleep(1300);
    return (await sampleWhilePlaying(1000)).peak;
  });
  if (!attempt.ok) {
    console.log(`    报错 ✗  ${LABEL[preset].padEnd(6)} ${attempt.error}`);
    results.push({ preset, mode: "switch", peak: 0, error: attempt.error });
    continue;
  }
  const ok = attempt.value > 0.005;
  console.log(`    ${ok ? "有声" : "静音 ✗"}  ${LABEL[preset].padEnd(6)} peak RMS = ${attempt.value.toFixed(5)}`);
  results.push({ preset, mode: "switch", peak: attempt.value });
}

const silent = results.filter((r) => r.peak <= 0.005);
console.log("");
console.log("  结论：" + (silent.length === 0
  ? "五种音色全部有实际输出"
  : "以下组合无声：" + silent.map((r) => `${LABEL[r.preset]}(${r.mode})`).join("、")));

await writeFile(`${OUT}/audio-probe.json`, JSON.stringify({ ctxInfo, results }, null, 2), "utf8");
console.log("  明细已写入:", `${OUT}/audio-probe.json`);
ws.close();
process.exit(0);
