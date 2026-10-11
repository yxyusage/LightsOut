/**
 * 极简 DOM 工具集。
 *
 * 刻意不引入任何框架：整个应用没有构建步骤、没有 node_modules，
 * 直接以原生 ES Module 运行。这里只提供真正被复用的几个原语。
 */

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

export const SVG_NS = "http://www.w3.org/2000/svg";

/** 只在内容变化时写入，避免每帧都触发样式重算 */
export function setText(node, text) {
  if (node && node.textContent !== text) node.textContent = text;
}

export function setHidden(node, hidden) {
  if (node) node.hidden = Boolean(hidden);
}

export function toggleClass(node, name, on) {
  node?.classList.toggle(name, Boolean(on));
}

export function clear(node) {
  if (!node) return;
  while (node.firstChild) node.removeChild(node.firstChild);
}

/**
 * 创建元素。
 * @param {string} tag
 * @param {object} [props] class / text / html / dataset / 事件 / 其它属性
 * @param {Array|Node|string} [children]
 */
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key === "html") node.innerHTML = value;
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value === true) node.setAttribute(key, "");
    else node.setAttribute(key, String(value));
  }
  append(node, children);
  return node;
}

export function append(parent, children) {
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return parent;
}

/** 创建 `<svg><use href="#id"/></svg>`，配合 index.html 里的图标精灵使用 */
export function icon(id, className) {
  const svg = document.createElementNS(SVG_NS, "svg");
  if (className) svg.setAttribute("class", className);
  const use = document.createElementNS(SVG_NS, "use");
  use.setAttribute("href", `#${id}`);
  svg.append(use);
  return svg;
}

/** 清空后重新填充列表 */
export function replaceChildren(node, children) {
  clear(node);
  append(node, children);
  return node;
}

let toastTimer = null;

/** 轻提示。同一时刻只显示一条，后到的覆盖先到的。 */
export function toast(message, { type = "info", duration = 2600 } = {}) {
  const node = $("#toast");
  if (!node) return;
  node.textContent = message;
  node.classList.toggle("toast--error", type === "error");
  node.hidden = false;
  // 重启动画
  node.style.animation = "none";
  void node.offsetWidth;
  node.style.animation = "";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    node.hidden = true;
  }, duration);
}

/**
 * 等待动画结束，并带一个兜底超时。
 * 兜底是必要的：页面切到后台时浏览器会暂停 CSS 动画，animationend 可能永远不来，
 * 那样熄灯界面就再也出不来了。
 */
export function onceAnimationEnd(node, fallbackMs) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      node.removeEventListener("animationend", finish);
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, fallbackMs);
    node.addEventListener("animationend", finish, { once: true });
  });
}

/** 供视图模块注册"点击外部关闭"用的通用关闭逻辑 */
export function bindDismiss(sheet, onClose) {
  sheet.addEventListener("click", (event) => {
    if (event.target.closest("[data-close]")) onClose();
  });
}
