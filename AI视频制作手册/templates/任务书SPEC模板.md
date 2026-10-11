# 短片制作规范（派给子代理的任务书模板）

> 用法：把 `{{...}}` 替换成你的项目信息，与 `templates/kit.css`、`kit.js`、样板片一起交给子代理。
> 这份模板来自一次 6 支片子并行生产的真实任务书，**每条硬约束都对应一个踩过的坑**。

---

## 0 先看这三样（不要跳过）

1. `{{样板片目录}}/index.html` —— **已通过校验并渲染成功的样板**：结构、时间轴写法、字幕调用、转场用法、3D 物块、光标、章节标签
2. `assets/kit.css` / `assets/kit.js` —— 共用设计系统与运行时（**只读，不要改**；需要新样式写在自己 HTML 里）
3. `assets/cues.json` —— 你这一支的字幕文案与时间（**不得改动时间**）

---

## 1 工程形态

每支短片是一个**独立工程**：

```
<你的短片目录>/
├── index.html          ← 你要写的合成（骨架已存在，可整体替换内容）
├── hyperframes.json
├── meta.json
└── assets/             ← kit.css · kit.js · vendor/gsap.min.js · ui/*.jpg
```

命令（在**短片目录内**执行）：

```bash
source ../env.sh                       # 沙箱环境（HOME 重定向 + 系统 Chrome + 关遥测）
"$HF_BIN" check .                      # 必过：0 error
"$HF_BIN" snapshot . --at 2,6,10,14     # 抽帧目视
"$HF_BIN" render . -o "../renders/<片名>.mp4" -f 30 --quality looks --quiet --workers 2
```

---

## 2 视觉系统

- 底色 `{{底色}}`，自带顶部打光 / 地脚渐变 / 纸纹颗粒 / 暗角 → 用 `.bg` + `.grain` 结构
- 墨色三级 `--ink` / `--ink-2` / `--ink-3`（**`--ink-3` 只用于非文字装饰**）
- 主色 `{{主色}}`，强调 `{{强调色}}`；其它语义色见 kit.css
- **对比度硬约束**：浅底正文**最浅只能用 `var(--ink-2)`**（≈5.4:1）；<24px 的字不要用 `--ink-3`；装饰性淡化标记请用**图形**（虚线框/渐变线），不要用浅色文字
- 字体：`{{中文字体}}` + `{{拉丁字体}}`。字号只用 400/500/600/700
- 常用类：`.h1 .h2 .h3 .body .mono .accent`、`.card`、`.chip`、`.badge`、`.chapter`、`.mark`

---

## 3 必须出现的手法

| 手法 | 实现方式 |
|---|---|
| **真实界面** | `<img src="assets/ui/xxx.jpg">` 放进 `.shotClip`（圆角 + 描边 + 溢出裁切） |
| **特写拉近** | `BL.cam(tl, img, {at,dur,z,x,y})`，`x,y` 用界面 CSS 坐标（截图基准 {{基准分辨率}}），`z ≥ 1.8` |
| **3D 物块托起画面** | `.stage3d > .block > .slab-shadow + .slab > .shotClip > img`，GSAP 动 `rotationX/rotationY/y/scale` |
| **动画鼠标 + 点击模拟** | `const cur = BL.cursor(scene)`；`cur.appear/to/click/hide`（自带按压 + 双层涟漪） |
| **页面翻转转场** | `BL.fx.flip(tl, incoming, outgoing, at, dur)` |
| **流线型引导线** | `<svg class="stream">` 放 `<path id="flow" class="glow">` + `<circle class="trail-dot">`，`BL.flow(tl,'#flow',dot,{at,draw,travel})` |
| **光带 / 白闪 / 圆形扩散** | `BL.fx.sweep(tl,at,dur)` / `BL.fx.flash(tl,at,peak)` / `BL.fx.circle(tl,el,at,cx,cy,dur)` |
| **介绍字幕（口播节奏）** | `BL.subtitles(tl, CUES, { total: 片长 })`；CUES 从 `assets/cues.json` 抄，时间不要改 |

光标目标坐标：`assets/rects.json`（CSS px，基准 {{基准分辨率}}）。映射：
`画面x = shotLeft + css_x / {{基准宽}} * shotWidth`

---

## 4 框架硬约束（违反会 lint error 或渲错帧）

1. **只用 GSAP 时间轴驱动动画**；CSS keyframes 不可 seek，禁止承担画面动效
2. 一条 `gsap.timeline({paused:true})` 注册到 `window.__timelines["<composition-id>"]`，key 必须等于根节点 `data-composition-id`
3. 根节点属性完整；`data-duration` 等于 cues.json 里的 `duration`
4. **元素不要在 CSS 里写 `transform` 又被 GSAP 动同一属性**；`scaleX/scaleY` 的元素必须已有真实宽高
5. `fromTo` 的**目标态必须显式包含 `opacity`**，否则冷启动 seek 可能整段不可见
6. 同一元素同一属性**不要有重叠 tween**；`fromTo` 除最早一条外都要 `immediateRender:false`
7. `onUpdate` 里**不要做 DOM 测量**（`getTotalLength`/`getBoundingClientRect`）→ 用 `BL.samplePath` 构建期采样
8. 字幕换行/居中由 `.subrow` 负责，**不要**在 `.sub` 上写 `translateX(-50%)`
9. 转场遮罩元素加 `data-layout-allow-occlusion`；推近溢出的图片加 `data-layout-allow-overflow`；有意越界 `-allow-overflow`；有意叠放 `-allow-overlap`
10. 片尾统一 `tl.to("#scene",{opacity:0,duration:.5}, 片长-0.65)`；**淡出只占最后 ~6%**（否则被对比度审计采样判失败）
11. 片头**章节标签的淡入要早于片长的 5.6%**（否则首个采样点落在淡入过程中）
12. 禁止 `Date.now()` / `Math.random()` / 渲染时联网
13. `nested_structure_needs_subcomposition` 是唯一允许保留的 warning

---

## 5 剪辑要求

- **机位**：不要全正面平铺，用 `.stage3d` 做 8°–20° 斜置，让物体有体积
- **光影**：物块下方必须有 `.slab-shadow` 接触阴影；截图有 1px 内描边；文字有极轻投影
- **节奏**：每 1.5–2.5 秒必须有一次视觉变化；不要出现超过 1.2 秒的完全静止
- **特写**：至少 2 次 `BL.cam` 到 `z ≥ 1.8`，对准真实控件
- **转场**：至少 3 种不同转场，同类不连用；每处转场要有视觉落点
- **收尾**：最后一秒留干净画面，便于与下一支衔接

---

## 6 完成标准（缺一不可）

1. `"$HF_BIN" check .` → **Lint 0 error / Layout 0 error / Motion 0 error / Contrast 全过**
2. `"$HF_BIN" render . -o "../renders/<片名>.mp4" -f 30 --quality looks --quiet --workers 2` 成功
3. `ffprobe` 复核：`nb_frames == 片长 × 30`、分辨率与帧率正确
4. **抽 4–6 帧 MP4 的帧**目视确认：字幕整句居中不换行、物块有阴影、特写对准控件、没有空帧
5. 回报：片名、时长、`check` 结论行、渲染文件大小、ffprobe 数字、用了哪些转场/动效、未达成项

## 7 版权红线

- **不要特写第三方内容**（视频播放器、他人视频帧、平台 logo）
- 特写只对准产品自身 UI（笔记、徽标、时间戳、按钮…）
- 需要时对不可避免区域做模糊/替换，并在回报里说明
