/**
 * 复用型表单控件：时段编辑器与选项胶囊组。
 *
 * 引导页和主页都要编辑睡眠时段，两处共用同一套控件可以保证
 * 校验规则、跨天提示、错误文案完全一致。
 */

import { DAY_TYPE, DAY_TYPE_LABELS } from "../core.js";
import { $, el, replaceChildren, setText, toggleClass } from "../lib/dom.js";

const MINUTES_PER_DAY = 1440;

function toMinutes(hhmm) {
  const [hours, minutes] = String(hhmm).split(":").map(Number);
  return hours * 60 + minutes;
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function fromMinutes(total) {
  const normalized = ((total % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return `${pad2(Math.floor(normalized / 60))}:${pad2(normalized % 60)}`;
}

/** 生成"23:00 → 次日 07:00 · 共 8 小时"这样的可读说明 */
export function describeWindow({ start, end }) {
  if (!start || !end) return "尚未设置";
  const startMinutes = toMinutes(start);
  const endMinutes = toMinutes(end);
  if (Number.isNaN(startMinutes) || Number.isNaN(endMinutes)) return "时间格式有误";
  if (startMinutes === endMinutes) return "开始与结束时间相同，无法生效";

  const crossesMidnight = endMinutes < startMinutes;
  const duration = (endMinutes - startMinutes + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const hours = Math.floor(duration / 60);
  const minutes = duration % 60;
  const durationText = minutes === 0 ? `${hours} 小时` : `${hours} 小时 ${minutes} 分`;

  return `${start} → ${crossesMidnight ? "次日 " : ""}${end} · 共 ${durationText}`;
}

/**
 * 时段编辑器。
 * @param {{
 *   container: HTMLElement,
 *   dayTypes?: string[],
 *   getValue: () => object,
 *   onChange: (dayType: string, patch: object) => void,
 *   onError?: (problems: string[]) => void
 * }} options
 */
export function createWindowEditor({ container, dayTypes = [DAY_TYPE.WEEKDAY, DAY_TYPE.WEEKEND], getValue, onChange, onError }) {
  const rows = new Map();

  function build(dayType) {
    const label = el("span", { class: "window-row__label", text: DAY_TYPE_LABELS[dayType] });
    const startInput = el("input", { type: "time", "aria-label": `${DAY_TYPE_LABELS[dayType]}开始时间`, dataset: { role: "start" } });
    const separator = el("span", { class: "window-row__sep", text: "→" });
    const endInput = el("input", { type: "time", "aria-label": `${DAY_TYPE_LABELS[dayType]}结束时间`, dataset: { role: "end" } });
    const meta = el("span", { class: "window-row__meta" });

    const row = el("div", { class: "window-row", dataset: { dayType } }, [label, startInput, separator, endInput, meta]);

    const commit = () => {
      const next = { start: startInput.value, end: endInput.value };
      onChange(dayType, next);
    };
    startInput.addEventListener("change", commit);
    endInput.addEventListener("change", commit);

    rows.set(dayType, { row, startInput, endInput, meta });
    return row;
  }

  replaceChildren(container, dayTypes.map(build));

  return {
    update() {
      const value = getValue();
      const problems = [];
      for (const [dayType, parts] of rows) {
        const window = value?.[dayType] ?? { start: "", end: "" };
        if (document.activeElement !== parts.startInput) parts.startInput.value = window.start ?? "";
        if (document.activeElement !== parts.endInput) parts.endInput.value = window.end ?? "";

        const description = describeWindow(window);
        setText(parts.meta, description);
        toggleClass(parts.row, "is-invalid", /有误|相同/.test(description));
        if (/有误|相同/.test(description)) problems.push(`${DAY_TYPE_LABELS[dayType]}：${description}`);
      }
      onError?.(problems);
    },
  };
}

/**
 * 选项胶囊组。
 * @param {{
 *   container: HTMLElement,
 *   options: Array<{ value: string|number, label: string, hint?: string }>,
 *   getValue: () => string|number,
 *   onSelect: (value: string|number) => void
 * }} params
 */
export function createChipGroup({ container, options, getValue, onSelect }) {
  const buttons = options.map((option) =>
    el("button", {
      type: "button",
      class: "chip",
      text: option.label,
      title: option.hint ?? "",
      dataset: { value: String(option.value) },
      onClick: () => onSelect(option.value),
    }),
  );

  replaceChildren(container, buttons);

  return {
    update() {
      const current = String(getValue());
      for (const button of buttons) {
        toggleClass(button, "is-selected", button.dataset.value === current);
        button.setAttribute("aria-pressed", button.dataset.value === current ? "true" : "false");
      }
    },
  };
}

/** 便捷函数：安全地取元素，找不到时给出明确报错而不是静默 null */
export function requireElement(selector) {
  const node = $(selector);
  if (!node) throw new Error(`缺少必需的 DOM 节点：${selector}`);
  return node;
}
