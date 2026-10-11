# 发布到 GitHub

本仓库已经是一个可以直接推送的 Git 仓库（已包含 `.gitignore`、`.gitattributes`、LICENSE、CI 工作流）。
下面是把它发布出去的完整步骤。

---

## 1. 在 GitHub 上创建空仓库

1. 打开 <https://github.com/new>；
2. **Repository name** 填 `xideng`（拼音，简短且不易重名；也可以换成你喜欢的名字）；
3. **Description** 建议填：

   ```
   熄灯早睡 · Lights Out —— 到点全屏接管设备的强制型睡眠辅助工具。Web/PWA + 桌面端 + Android，零依赖、离线可用、数据不出本机。
   ```

4. 可见性选 **Public**（赛事作品建议公开，便于评审查看）；
5. **不要**勾选 "Add a README file"、"Add .gitignore"、"Choose a license" —— 本地已经都有了；
6. 点 **Create repository**。

---

## 2. 推送本地仓库

把下面命令里的 `<你的用户名>` 换掉，然后执行：

```bash
cd "E:\deepseek Harness\熄灯早睡"

# 确认当前分支名（本仓库初始化时为 master）
git branch -M main

git remote add origin https://github.com/<你的用户名>/xideng.git
git push -u origin main
```

> 如果你配置了 SSH，也可以用 `git@github.com:<你的用户名>/xideng.git`。

---

## 3. 配置仓库信息（让项目更容易被找到）

进入 **Settings → General**：

| 字段 | 建议值 |
| --- | --- |
| Description | 同上面的仓库描述 |
| Website | 部署后的公网地址（见下一步） |

进入仓库首页右上角的 **⚙️ Topics**，添加：

```
sleep  pwa  sleep-tracker  digital-wellbeing  focus  self-control
web-audio  offline-first  zero-dependency  android  avalonia  mit-license
```

---

## 4. 开启 GitHub Pages（自动获得公网 URL）

1. 进入 **Settings → Pages**；
2. **Source** 选择 **GitHub Actions**（不是 "Deploy from a branch"）；
3. 回到仓库的 **Actions** 标签，找到 **Deploy to GitHub Pages**，点 **Run workflow**；
4. 等 1–2 分钟，站点会发布在：

   ```
   https://<你的用户名>.github.io/xideng/
   ```

这个地址就是**赛事提交表单里的「作品 URL」**。

> 应用内部全部使用相对路径，所以部署在 `/xideng/` 这样的子路径下不需要任何额外配置。

---

## 5. 打标签并发布 Release（可选，但推荐）

赛事材料里可以附上 Release 链接，显得更完整：

```bash
git tag -a v1.0.0 -m "熄灯早睡 v1.0.0 — 参赛版本"
git push origin v1.0.0
```

然后在 GitHub 的 **Releases → Draft a new release**：

- Tag：`v1.0.0`
- Title：`熄灯早睡 v1.0.0 — 参赛版本`
- 描述：把 `CHANGELOG.md` 里 1.0.0 那一节贴进去；
- 附件：可以上传一个打包好的静态站点压缩包，方便别人直接下载部署。

---

## 6. 提交前的最终检查

在浏览器里打开 GitHub Pages 的地址，逐项确认：

- [ ] 主页正常显示，没有控制台报错
- [ ] 点「**立即体验熄灯模式**」能看到完整的熄灯黑屏界面
- [ ] 熄灯界面里有拉灯绳动画、时钟、轮播文案、底部两个入口
- [ ] 「助眠音乐」能选音色、能播放（需要点一下才开始，这是浏览器策略）
- [ ] 「白名单应用」能添加与移除
- [ ] 「数据溯源」能看到 5 条文献
- [ ] 手机浏览器「添加到主屏幕」后能全屏运行
- [ ] **断网后刷新，界面仍能打开**
- [ ] `https://<你的用户名>.github.io/xideng/sw.js` 能正常返回内容

---

## 7. 关于「三个端」的说明

仓库里同时包含 Web 端与两个原生端：

| 目录 | 状态 | 说明 |
| --- | --- | --- |
| `apps/web` | ✅ 已完成，已通过 108 项单测与截图验证 | 赛事提交的作品主体 |
| `platforms/desktop` | 见该目录 README | Avalonia 跨平台桌面端 |
| `platforms/android` | 见该目录 README | Kotlin 原生端 |

**原生端在当前开发环境未能完成编译验证**（缺少 Android SDK 与相应工具链），
这一限制已如实写在各自的 README 与主 README 中。
如果评审或贡献者需要，可以在具备工具链的环境按各自 README 的步骤构建。

---

## 8. 后续维护建议

- **评审期间保持可访问**：赛事要求作品在投稿及评审期间保持可访问状态
  （第一期季度赛：2026-12-06 截止，之后约 10 个工作日评审）。GitHub Pages 免费且稳定，
  不需要额外维护。
- **提交信息写清楚「为什么」**：这是给未来贡献者（和未来的自己）看的。
- **不要提交 `dist/`**：它已经在 `.gitignore` 里，由 CI 构建。
- **开启 Dependabot**：本项目零依赖，所以基本不会有告警 —— 这本身就是零依赖的一个好处。
