/**
 * 拉灯绳明灭动画控制器（PRD 4.3）。
 *
 * 入场：灯绳下拉 → 灯泡亮一下 → 熄灭 → 屏幕渐暗至全黑
 * 退场：灯绳再次拉动 → 灯泡由暗点亮 → 屏幕从全黑渐亮
 *
 * 动画本身完全由 CSS 完成，这里只负责编排时序与生命周期。
 */

import { onceAnimationEnd } from "./dom.js";

export function createLamp({ element, durationMs = 1500 }) {
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

  return {
    playEnter: () => play("enter"),
    playExit: () => play("exit"),
    get busy() {
      return busy;
    },
  };
}

export const ANIMATION_MS = 1500;
