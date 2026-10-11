/* ============================================================================
   BiliLearn-AI 宣传片 · 运行时工具
   - 字幕引擎：按正常口播语速排时间轴（中文 4.3 字/秒），并可与 SRT 完全对齐
   - 动画鼠标：移动 + 按压 + 点击涟漪
   - 镜头：对真实界面截图做平滑推近特写（CSS 坐标系 1600x900）
   - 流线：沿 SVG 路径引导视线
   - 转场：翻页 / 光带 / 白闪 / 圆形扩散
   ========================================================================== */
(function () {
  "use strict";

  const CHARS_PER_SEC = 4.3;   // 中文口播常规语速
  const MIN_DUR = 1.5;
  const GAP = 0.18;            // 句间换气

  /* ---------------- 字幕 ---------------- */
  function cueDur(text) {
    const len = (text || "").replace(/\s/g, "").length;
    return Math.max(MIN_DUR, +(len / CHARS_PER_SEC).toFixed(2));
  }

  /** 把 [{t,text}] 排成带时长的字幕轨，并检查是否超出口播时间 */
  function layout(cues) {
    const out = [];
    cues.forEach((c, i) => {
      const dur = c.dur != null ? c.dur : cueDur(c.text);
      const start = c.t;
      const end = +(start + dur).toFixed(2);
      const next = cues[i + 1];
      if (next && next.t < end + GAP) {
        console.warn(`[BL] 字幕 ${i + 1} 语速偏快：需要 ${dur}s，实际只有 ${(next.t - start).toFixed(2)}s → 「${c.text}」`);
      }
      out.push({ text: c.text, start, dur, end });
    });
    return out;
  }

  /** 在时间轴上铺字幕；opts.light 用浅色样式（浅底用） */
  function subtitles(tl, cues, opts) {
    opts = opts || {};
    const laid = layout(cues);
    const wrap = document.getElementById("subwrap");
    const nodes = laid.map((c) => {
      const row = document.createElement("div");   // 每句独占一行并居中，避免多条字幕并排挤压
      row.className = "subrow";
      const d = document.createElement("div");
      d.className = "sub" + (opts.light ? " light" : "");
      d.innerHTML = c.text;
      row.appendChild(d);
      wrap.appendChild(row);
      return d;
    });
    laid.forEach((c, i) => {
      const el = nodes[i];
      tl.fromTo(el, { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: .26, ease: "power2.out" }, c.start);
      tl.to(el, { opacity: 0, y: -10, duration: .22, ease: "power2.in" }, c.end - 0.02);
    });
    if (opts.progress !== false) {
      const bar = document.querySelector("#subline i");
      if (bar) tl.fromTo(bar, { width: "0%" }, { width: "100%", duration: opts.total || 20, ease: "none" }, 0);
    }
    window.__blCues = laid;   // 供外部核对 / 导出
    return laid;
  }

  /** 生成 SRT 文本（与画面字幕逐帧一致） */
  function srt(cues, title) {
    const laid = layout(cues);
    const p = (n) => String(n).padStart(2, "0");
    const stamp = (s) => {
      const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
      const sec = Math.floor(s % 60), ms = Math.round((s - Math.floor(s)) * 1000);
      return `${p(h)}:${p(m)}:${p(sec)},${String(ms).padStart(3, "0")}`;
    };
    const body = laid.map((c, i) =>
      `${i + 1}\n${stamp(c.start)} --> ${stamp(c.end)}\n${c.text}\n`).join("\n");
    return (title ? `# ${title}\n\n` : "") + body;
  }

  /* ---------------- 动画鼠标 ---------------- */
  const CURSOR_SVG = `<svg viewBox="0 0 32 38" width="34" height="40" xmlns="http://www.w3.org/2000/svg">
    <path d="M5 3 L5 31 L12.4 23.6 L17.6 34.6 L22.4 32.4 L17.2 21.6 L27.6 21 L5 3 Z"
          fill="#141A1F" stroke="#FFFFFF" stroke-width="2.4" stroke-linejoin="round"/></svg>`;

  function cursor(root) {
    const el = document.createElement("div");
    el.className = "cursor";
    el.innerHTML = CURSOR_SVG;
    (root || document.body).appendChild(el);
    const mk = () => { const r = document.createElement("div"); r.className = "ripple"; (root || document.body).appendChild(r); return r; };
    const r1 = mk(), r2 = mk(); r2.classList.add("solid");

    const api = {
      el,
      /** 移动到 CSS 坐标（相对 #scene） */
      to(tl, x, y, at, dur, ease) {
        tl.to(el, { x, y, duration: dur == null ? 1.0 : dur, ease: ease || "power2.inOut" }, at);
        return api;
      },
      /** 从当前位置淡入 */
      appear(tl, at, x, y) {
        tl.set(el, { x, y, opacity: 0 }, at);
        tl.to(el, { opacity: 1, duration: .3, ease: "power2.out" }, at);
        return api;
      },
      hide(tl, at) { tl.to(el, { opacity: 0, duration: .3 }, at); return api; },
      /** 点击：按压 + 双层涟漪 */
      click(tl, at, x, y) {
        if (x != null) tl.set(el, { x, y }, at - 0.001);
        tl.to(el, { scale: .84, duration: .1, ease: "power2.in" }, at);
        tl.to(el, { scale: 1, duration: .3, ease: "back.out(2.2)" }, at + 0.1);
        [r1, r2].forEach((r, i) => {
          tl.set(r, { x, y, scale: .3, opacity: .6 }, at + i * 0.07);
          tl.to(r, { scale: i ? 4.2 : 3.0, opacity: 0, duration: .62, ease: "power2.out" }, at + i * 0.07);
        });
        return api;
      },
    };
    return api;
  }

  /* ---------------- 镜头推近（真实界面特写） ----------------
     x,y 用界面截图的 CSS 坐标（截图为 1600x900 时即原坐标）；z 为放大倍数 */
  const camState = new WeakMap();
  function cam(tl, img, o) {
    const known = camState.has(img);
    const from = camState.get(img) || { z: 1, x: 800, y: 450 };
    const to = {
      z: o.z == null ? from.z : o.z,
      x: o.x == null ? from.x : o.x,
      y: o.y == null ? from.y : o.y,
    };
    const apply = (v) => {
      const px = v.x / 1600, py = v.y / 900;
      const tx = 100 * v.z * (0.5 - px), ty = 100 * v.z * (0.5 - py);
      img.style.transform = `translate(${tx}%, ${ty}%) scale(${v.z})`;
    };
    // 只有第一次调用才在构建期落初始态；否则第二次调用会把上一次的终点提前写进 DOM，
    // 冷启动 worker 从 t=0 取帧时就会看到已经放大过的画面。
    if (!known) apply(from);
    camState.set(img, to);
    const proxy = Object.assign({}, from);
    tl.to(proxy, Object.assign({}, to, {
      duration: o.dur == null ? 1.1 : o.dur,
      ease: o.ease || "power2.inOut",
      onUpdate: () => apply(proxy),
    }), o.at);
    return to;
  }

  /* ---------------- 流线引导 ----------------
     路径点在构建期一次性采样，onUpdate 里不再做任何 DOM 测量（渲染器会反复 seek） */
  function samplePath(pathEl, n) {
    const total = pathEl.getTotalLength();
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const pt = pathEl.getPointAtLength((total * i) / n);
      pts.push([pt.x, pt.y]);
    }
    return { pts, total };
  }

  function flow(tl, svgSel, dot, o) {
    const path = typeof svgSel === "string" ? document.querySelector(svgSel) : svgSel;
    const sampled = samplePath(path, 240);
    path.style.strokeDasharray = sampled.total;
    path.style.strokeDashoffset = sampled.total;
    tl.to(path, { strokeDashoffset: 0, duration: o.draw == null ? 1.1 : o.draw, ease: o.ease || "power2.inOut" }, o.at);
    if (dot) {
      const pts = sampled.pts, proxy = { p: 0 };
      tl.fromTo(dot, { opacity: 0 }, { opacity: 1, duration: .25 }, o.at);
      tl.to(proxy, {
        p: 1, duration: o.travel == null ? 1.4 : o.travel, ease: o.ease || "power2.inOut",
        onUpdate: () => {
          const i = Math.max(0, Math.min(pts.length - 1, Math.round(proxy.p * (pts.length - 1))));
          dot.setAttribute("transform", "translate(" + pts[i][0] + " " + pts[i][1] + ")");
        },
      }, o.at + (o.dotDelay == null ? 0.15 : o.dotDelay));
      if (o.fadeDot !== false) tl.to(dot, { opacity: 0, duration: .35 }, o.at + (o.travel || 1.4) + 0.17);
    }
  }

  /* ---------------- 转场 ---------------- */
  const fx = {
    /** 白闪 */
    flash(tl, at, peak) {
      const el = document.querySelector(".flash");
      tl.set(el, { opacity: 0 }, at);
      tl.to(el, { opacity: peak == null ? .92 : peak, duration: .1, ease: "power2.in" }, at);
      tl.to(el, { opacity: 0, duration: .34, ease: "power2.out" }, at + 0.1);
    },
    /** 光带扫过 */
    sweep(tl, at, dur, reverse) {
      const el = document.querySelector(".sweep");
      tl.set(el, { x: reverse ? 1920 : -520, opacity: 0, skewX: -14 }, at);
      tl.to(el, { opacity: .9, duration: dur * .35 }, at);
      tl.to(el, { x: reverse ? -520 : 1920, duration: dur, ease: "power2.inOut" }, at);
      tl.to(el, { opacity: 0, duration: dur * .3 }, at + dur * .7);
    },
    /** 翻页：outgoing 绕左缘翻走，incoming 从右侧翻入 */
    flip(tl, incoming, outgoing, at, dur) {
      dur = dur || 0.72;
      if (outgoing) {
        tl.to(outgoing, { rotationY: -26, x: -140, scale: .94, opacity: 0, duration: dur, ease: "power3.in" }, at);
      }
      if (incoming) {
        tl.fromTo(incoming,
          { rotationY: 24, x: 180, scale: .95, opacity: 0, transformPerspective: 2200, transformOrigin: "0% 50%" },
          { rotationY: 0, x: 0, scale: 1, opacity: 1, duration: dur, ease: "power3.out" }, at + 0.04);
      }
    },
    /** 圆形扩散（复用 app 主题切换语言） */
    circle(tl, el, at, cx, cy, dur, reverse) {
      const r = 1500;
      tl.set(el, { opacity: 1, clipPath: reverse ? `circle(0px at ${cx}px ${cy}px)` : `circle(${r}px at ${cx}px ${cy}px)` }, at);
      tl.fromTo(el, { clipPath: `circle(${reverse ? r : 0}px at ${cx}px ${cy}px)` },
        { clipPath: `circle(${reverse ? 0 : r}px at ${cx}px ${cy}px)`, duration: dur || .8, ease: "power2.inOut" }, at);
      if (reverse) tl.to(el, { opacity: 0, duration: .2 }, at + (dur || .8) - 0.2);
    },
  };

  /* ---------------- 文字：逐字浮现 ---------------- */
  function typeIn(tl, el, at, speed) {
    const text = el.dataset.text || el.textContent;
    el.dataset.text = text;
    el.textContent = "";
    const chars = [...text];
    const step = speed || 0.035;
    const spans = chars.map((ch) => {
      const s = document.createElement("span");
      s.textContent = ch; s.style.opacity = 0; s.style.display = "inline-block";
      if (ch === " ") s.style.width = ".32em";
      el.appendChild(s); return s;
    });
    tl.to(spans, { opacity: 1, duration: .01, stagger: step, ease: "none" }, at);
    return at + chars.length * step;
  }

  window.BL = { CHARS_PER_SEC, cueDur, layout, subtitles, srt, cursor, cam, flow, samplePath, fx, typeIn,
                cursorSVG: CURSOR_SVG };
})();
