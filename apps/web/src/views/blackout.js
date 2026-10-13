/**
 * 熄灯黑屏界面 + 预告弹窗（PRD 2.2.2 / 2.1.2）。
 *
 * 这两个界面都必须"甩不掉"，所以它们的显隐不由用户操作决定，
 * 而是完全由引擎相位（phase）驱动 —— 见 app.js 的 applyPhase()。
 */

import { $, setHidden, setText } from "../lib/dom.js";

export function createBlackoutView(ctx) {
  const { core } = ctx;

  const root = $("#screen-blackout");
  const els = {
    clock: $("#blackout-clock"),
    remainingPrefix: $("#blackout-remaining-prefix"),
    remaining: $("#blackout-remaining"),
    scene: $("#blackout-scene"),
    progress: $("#blackout-progress"),
    copy: $("#blackout-copy-text"),
    source: $("#blackout-source"),
    sourceLabel: $("#blackout-source-label"),
    badge: $("#whitelist-badge"),
    demo: $("#blackout-demo"),
    tapHint: $("#tap-hint"),
    tapHintText: $("#tap-hint-text"),
    exceptionBlock: $("#exception-block"),
    exceptionTrigger: $("#btn-exception"),
    exceptionForm: $("#exception-form"),
    exceptionInput: $("#exception-input"),
    exceptionSubmit: $("#btn-exception-submit"),
    exceptionVerdict: $("#exception-verdict"),
  };

  /* ───────── 例外说明（AI 裁定）───────── */

  let exceptionBusy = false;

  els.exceptionTrigger.addEventListener("click", () => {
    setHidden(els.exceptionForm, false);
    setHidden(els.exceptionTrigger, true);
    setHidden(els.exceptionVerdict, true);
    els.exceptionInput.focus();
  });

  els.exceptionForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (exceptionBusy) return;
    const said = els.exceptionInput.value.trim();
    if (!said) return;

    exceptionBusy = true;
    setText(els.exceptionSubmit, "判断中…");
    els.exceptionSubmit.disabled = true;
    setHidden(els.exceptionVerdict, false);
    els.exceptionVerdict.className = "exception__verdict";
    setText(els.exceptionVerdict, "AI 正在判断这个情况…");

    const result = await ctx.actions.decideException(said);

    exceptionBusy = false;
    setText(els.exceptionSubmit, "交给 AI 判断");
    els.exceptionSubmit.disabled = false;

    if (!result.ok) {
      els.exceptionVerdict.className = "exception__verdict is-error";
      setText(els.exceptionVerdict, result.message);
      return;
    }

    const d = result.decision;
    // 把 AI 的判断过程原样展示出来。
    // 只给结论会让人以为"随便说说就能免锁"，而看清它识别了什么、为什么这么判，
    // 才建立得起信任 —— 这也是这个产品最重要的东西。
    const lines = [];
    if (d.understood) lines.push(`识别到：${d.understood}`);
    if (result.grant) {
      lines.push(`判断：可以放宽 ${d.minutes} 分钟`);
    } else {
      lines.push("判断：不构成需要放宽的情况");
    }
    if (d.reason) lines.push(d.reason);
    if (result.grant) {
      lines.push(`本次消耗 1 次紧急解除额度，本周还剩 ${result.remaining} 次。`);
    } else {
      lines.push("没有消耗额度。");
    }

    els.exceptionVerdict.className = `exception__verdict ${result.grant ? "is-granted" : "is-denied"}`;
    setText(els.exceptionVerdict, lines.join("\n"));
    if (result.grant) els.exceptionInput.value = "";
  });

  function resetExceptionPanel() {
    setHidden(els.exceptionForm, true);
    setHidden(els.exceptionTrigger, false);
    setHidden(els.exceptionVerdict, true);
    els.exceptionInput.value = "";
  }

  let lastCopyId = null;
  let copySwapTimer = null;
  let tapHideTimer = null;

  // ── 连续点击 5 次触发紧急解除（PRD 2.2.5）──
  const tapCounter = core.createTapCounter({
    required: core.EMERGENCY_TAP_COUNT,
    windowMs: core.EMERGENCY_TAP_WINDOW_MS,
    onTrigger: () => {
      setHidden(els.tapHint, true);
      ctx.actions.openEmergency();
    },
  });

  root.addEventListener("click", (event) => {
    // 底部入口按钮的点击不计入连击
    if (event.target.closest("button, a")) return;
    const result = tapCounter.tap();
    if (result.triggered) return;
    if (result.progress >= 2) {
      setText(els.tapHintText, `再点击 ${result.remaining} 次可紧急解除`);
      setHidden(els.tapHint, false);
      clearTimeout(tapHideTimer);
      tapHideTimer = setTimeout(() => setHidden(els.tapHint, true), 2400);
    }
  });

  /**
   * 今夜进度。
   *
   * 只在"真实处于熄灯时段内"时显示。演示模式下没有真实的时段，
   * 若仍画一条进度就是编造 —— 宁可隐藏。
   */
  function renderProgress(snapshot, ui) {
    const wrap = els.progress?.parentElement;
    if (!wrap) return;

    const window = snapshot.window;
    const isRealActive = !ui.isDemo() && snapshot.phase === core.PHASE.ACTIVE && Boolean(window);
    if (!isRealActive) {
      setHidden(wrap, true);
      return;
    }

    const totalMs = window.end.getTime() - window.start.getTime();
    const elapsedMs = snapshot.at.getTime() - window.start.getTime();
    const ratio = totalMs > 0 ? Math.min(1, Math.max(0, elapsedMs / totalMs)) : 0;
    elwidth(els.progress, `${(ratio * 100).toFixed(2)}%`);
    setHidden(wrap, false);
  }

  /** 只在值真的变化时写入，避免每 250ms 触发一次样式重算 */
  function elwidth(node, next) {
    if (node.style.width !== next) node.style.width = next;
  }

  function renderCopy(snapshot) {
    const copy = snapshot.copy;
    if (copy.id === lastCopyId) return;
    lastCopyId = copy.id;

    // 交叉淡入淡出，避免文案硬切造成的闪烁
    els.copy.classList.add("is-fading");
    clearTimeout(copySwapTimer);
    copySwapTimer = setTimeout(() => {
      setText(els.copy, copy.text);
      els.copy.classList.remove("is-fading");
    }, 260);

    const fact = copy.source ? core.FACT_SOURCES[copy.source] : null;
    setHidden(els.source, !fact);
    if (fact) setText(els.sourceLabel, `数据来源：${fact.label}`);
    els.source.dataset.sourceId = copy.source ?? "";
  }

  /** 每帧调用；只做必要的写入 */
  function update(snapshot, ui) {
    setText(els.clock, core.formatClock(snapshot.at));

    if (ui.isDemo()) {
      setText(els.remainingPrefix, "演示模式");
      setText(els.remaining, `还剩 ${core.formatCountdownCN(ui.demoRemainingMs())}`);
      setHidden(els.demo, false);
    } else {
      setText(els.remainingPrefix, "现在睡，还能睡");
      setText(els.remaining, core.formatDurationCN(snapshot.remainingMs));
      setHidden(els.demo, true);
    }

    setText(els.scene, `${snapshot.scene.sceneLabel} · ${snapshot.scene.dateKey}`);
    renderProgress(snapshot, ui);
    renderCopy(snapshot);

    const remainingMinutes = Math.ceil(snapshot.whitelistRemainingMs / 60_000);
    setText(els.badge, remainingMinutes > 0 ? `${remainingMinutes} 分` : "已用尽");

    // 例外入口：只在"有 AI 可用 + 真实熄灯中 + 额度没耗尽"时出现。
    // 演示模式不显示 —— 那里没有真实的时段，放宽它没有意义。
    const canAskException =
      ctx.ai.available && !ui.isDemo() && !snapshot.whitelist.exhausted && snapshot.phase === core.PHASE.ACTIVE;
    setHidden(els.exceptionBlock, !canAskException);

    // 已经放宽过：把结论常驻显示，让"今晚为什么能再熬一会儿"始终有据可查
    if (snapshot.exception && snapshot.exception.extraMs > 0) {
      const mins = Math.round(snapshot.exception.extraMs / 60_000);
      setHidden(els.exceptionVerdict, false);
      els.exceptionVerdict.className = "exception__verdict is-granted";
      setText(
        els.exceptionVerdict,
        [
          snapshot.exception.understood ? `识别到：${snapshot.exception.understood}` : "",
          `判断：今晚放宽 ${mins} 分钟`,
          snapshot.exception.reason ?? "",
        ]
          .filter(Boolean)
          .join("\n"),
      );
    }
  }

  /** 离开熄灯界面时复位，保证下次进入从第一句文案开始 */
  function reset() {
    lastCopyId = null;
    clearTimeout(copySwapTimer);
    clearTimeout(tapHideTimer);
    tapCounter.reset();
    setHidden(els.tapHint, true);
    els.copy.classList.remove("is-fading");
    // 收起例外面板：上次的裁定结论不该带到下一次熄灯
    resetExceptionPanel();
  }

  $("#btn-open-whitelist").addEventListener("click", () => ctx.actions.openSheet("whitelist"));
  $("#btn-open-audio").addEventListener("click", () => ctx.actions.openSheet("audio"));
  $("#btn-exit-demo").addEventListener("click", (event) => {
    event.stopPropagation();
    ctx.actions.exitDemo();
  });
  els.source.addEventListener("click", (event) => {
    event.stopPropagation();
    ctx.actions.openSheet("sources");
  });

  return { root, update, reset };
}

/* ─────────────────────────────────────────────────────────────
   预告弹窗（PRD 2.1.2）：全屏半透明、不可关闭、只显示倒计时
   ───────────────────────────────────────────────────────────── */
export function createWarningView() {
  const root = $("#screen-warning");
  const els = {
    countdown: $("#warning-countdown"),
    detail: $("#warning-detail"),
  };

  function update(snapshot) {
    const totalSeconds = Math.max(0, Math.ceil(snapshot.remainingMs / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    setText(els.countdown, `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`);

    const start = snapshot.window?.start;
    setText(els.detail, start ? `${formatClock(start)} 开始熄灯，请保存好正在进行的事情。` : "即将进入熄灯模式。");
  }

  return { root, update };
}

function formatClock(date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
