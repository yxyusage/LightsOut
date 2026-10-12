/**
 * 拉灯绳动画控制器（PRD 4.3）。
 *
 * 入场：灯绳下拉 → 灯泡亮一下 → 熄灭 → 屏幕渐暗至全黑
 * 退场：灯绳再次拉动 → 灯泡由暗点亮 → 屏幕从全黑渐亮
 *
 * 除了自动播放的明灭动画，这里还负责**拉绳仪式**：进入熄灯时段时，
 * 由用户亲手把灯绳拉到底，才播放入场动画。行为与桌面端
 * platforms/desktop/Views/BlackoutWindow.axaml.cs 对齐。
 *
 * 动画本身完全由 CSS 完成，这里只负责编排时序与生命周期。
 */

import { onceAnimationEnd } from "./dom.js";

/** 不拉绳时的兜底：到点自动熄灭 */
export const PULL_TIMEOUT_MS = 10_000;

/** 拉到底所需的位移（CSS 像素） */
const PULL_MAX_PX = 96;

export function createLamp({ element, promptElement, durationMs = 1500 }) {
  let busy = false;

  async function play(mode) {
    if (!element || busy) return false;
    busy = true;

    element.classList.remove("lamp--enter", "lamp--exit");
    element.hidden = false;
    // 强制回流，确保同名动画被重新触发（连续播放时必需）
    void element.offsetWidth;

    element.classList.add(`lamp--${mode}`);
    await onceAnimationEnd(element, durationMs + 200);

    element.classList.remove(`lamp--${mode}`);
    element.hidden = true;
    busy = false;
    return true;
  }

  /**
   * 拉绳仪式：等待用户把灯绳拉到底，返回 'pulled' 或 'timeout'。
   *
   * 三条约束（与桌面端一致）：
   *  1. 拉不到底就松手会**回弹**，和真实灯绳一样；
   *  2. 超时会**自动熄灭** —— 仪式感绝不能变成"必须拉对才能进入熄灯"，
   *     否则用户卡在这里，强制接管反而失效了。这条兜底是刚性要求。
   *  3. 支持键盘（回车/空格）代替拖拽：鼠标用户和「减少动效」的用户也得能过。
   *
   * @param {{ timeoutMs?: number }} [options]
   * @returns {Promise<'pulled' | 'timeout'>}
   */
  function awaitPull({ timeoutMs = PULL_TIMEOUT_MS } = {}) {
    if (!element) return Promise.resolve("timeout");

    return new Promise((resolve) => {
      let offset = 0;
      let dragging = false;
      let startY = 0;
      let settleTimer = null;
      let countdownTimer = null;
      let secondsLeft = Math.ceil(timeoutMs / 1000);
      let done = false;

      const applyOffset = (value) => {
        offset = Math.max(0, Math.min(PULL_MAX_PX, value));
        element.style.setProperty("--pull", `${offset.toFixed(1)}px`);
      };

      // 倒计时写进专门的子元素，避免把标题一起覆盖掉
      const timerElement = promptElement?.querySelector(".lamp__prompt-timer") ?? null;

      const renderPrompt = () => {
        if (!timerElement) return;
        timerElement.textContent =
          secondsLeft > 0 ? `灯将在 ${secondsLeft} 秒后自动熄灭` : "灯已自动熄灭";
      };

      const finish = (reason) => {
        if (done) return;
        done = true;
        dragging = false;
        window.clearInterval(countdownTimer);
        window.clearTimeout(settleTimer);
        element.classList.remove("lamp--pull");
        // 记下"这次是从拉绳阶段进来的"：入场动画要从压暗值接上，而不是从全透明开始
        element.classList.add("is-from-pull");
        element.style.removeProperty("--pull");
        element.removeEventListener("pointerdown", onPointerDown);
        element.removeEventListener("pointermove", onPointerMove);
        element.removeEventListener("pointerup", onPointerUp);
        element.removeEventListener("pointercancel", onPointerUp);
        element.removeEventListener("keydown", onKeyDown);
        if (promptElement) promptElement.hidden = true;
        resolve(reason);
      };

      // 没拉到底 → 松手回弹（16ms 一步，和桌面端的 SnapBack 一致）
      const snapBack = () => {
        const step = () => {
          applyOffset(offset - Math.max(3, offset * 0.22));
          if (offset <= 0.5) {
            applyOffset(0);
            settleTimer = null;
            return;
          }
          settleTimer = window.setTimeout(step, 16);
        };
        step();
      };

      function onPointerDown(event) {
        if (done) return;
        window.clearTimeout(settleTimer);
        settleTimer = null;
        dragging = true;
        startY = event.clientY;
        element.setPointerCapture?.(event.pointerId);
      }

      function onPointerMove(event) {
        if (!dragging || done) return;
        applyOffset(event.clientY - startY);
        // 拉到底立即触发，不必等松手 —— 和真实灯绳一样有"咔哒"感
        if (offset >= PULL_MAX_PX) finish("pulled");
      }

      function onPointerUp() {
        if (!dragging || done) return;
        dragging = false;
        if (offset >= PULL_MAX_PX) finish("pulled");
        else if (offset > 0) snapBack();
      }

      // 键盘等价路径：回车/空格直接算拉到底
      function onKeyDown(event) {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          finish("pulled");
        }
      }

      element.hidden = false;
      element.classList.add("lamp--pull");
      if (promptElement) {
        promptElement.hidden = false;
        renderPrompt();
      }
      applyOffset(0);

      element.addEventListener("pointerdown", onPointerDown);
      element.addEventListener("pointermove", onPointerMove);
      element.addEventListener("pointerup", onPointerUp);
      element.addEventListener("pointercancel", onPointerUp);
      element.addEventListener("keydown", onKeyDown);

      countdownTimer = window.setInterval(() => {
        secondsLeft -= 1;
        renderPrompt();
        if (secondsLeft <= 0) finish("timeout");
      }, 1000);
    });
  }

  return {
    playEnter: () => play("enter"),
    playExit: () => play("exit"),
    awaitPull,
    get busy() {
      return busy;
    },
  };
}

export const ANIMATION_MS = 1500;
