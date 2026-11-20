# 科技新闻 · 独立部署版

报纸风格的科技新闻聚合站：服务端定时拉取公开 RSS，分类展示、标题搜索、站内展开摘要、原文跳转。
为部署到 **Altare App Hosting** 准备的独立 Node.js 应用（和 Muse 里的原站 `ke-ji-wang-zhan` 内容一致、代码独立）。

## 来源

| 来源 | Feed 地址 | 状态 |
|---|---|---|
| IT之家 | https://www.ithome.com/rss/ | ✅ 2026-11-20 实测可用 |
| 爱范儿 | https://www.ifanr.com/feed | ✅ 2026-11-20 实测可用 |
| 雷峰网 | https://www.leiphone.com/feed | ✅ 2026-11-20 实测可用 |
| 极客公园 | https://www.geekpark.net/rss | ✅ 2026-11-20 实测可用 |
| 少数派 | https://sspai.com/feed | ✅ 2026-11-20 实测可用 |

五个来源在 2026-11-20 全部实测可用；如果某个来源日后失效，服务端会自动跳过它（其余来源不受影响），并在启动日志里打印失败原因。

## 技术

- **零 npm 依赖**：只用 Node 内置模块（`http` / `fs` / `path`）+ Node 20+ 自带 `fetch`，不需要 `npm install`，构建不会因为装依赖失败。
- `server.js`：拉取 RSS（自写轻量解析：正则提 `<item>`，取 title / link / pubDate / description，提取首张图片）、按标题关键词分到 AI / 手机数码 / 汽车 / 互联网 / 其他、去重、按时间倒序、最多保留 300 篇；内存 + `data/cache.json` 双缓存。
- 刷新策略：启动拉一次，之后每 30 分钟拉一次；文章超过 3 小时没更新时，下次请求触发后台刷新。
- 首页 `index.html`：报纸风格，分类切换、搜索框、手动刷新按钮、上次更新时间显示，点击标题展开摘要并给原文链接，手机端自适应。

## 接口

| 接口 | 说明 |
|---|---|
| `GET /` | 报纸风格首页 |
| `GET /api/news?category=AI&q=关键词` | JSON 文章列表（支持按分类和关键词过滤） |
| `POST /api/refresh` | 触发一次后台刷新 |
| `GET /health` | 健康检查，返回 `{"status":"ok"}`（Altare 用） |

应用监听 `0.0.0.0:$PORT`（默认 3000，未设 `PORT` 时）。

## 本地运行

```bash
node --version   # 需要 Node 20+（Altare 用 Node 24）
node server.js   # 打开 http://localhost:3000
```

不需要安装任何依赖。文章缓存在 `data/cache.json`，删掉它会在下次启动时重新拉取。

## 部署到 Altare（App Hosting）

1. **建 GitHub 公开仓库**：把本目录的全部文件（`package.json`、`server.js`、`index.html`、`README.md`；`data/` 不用提交）推到一个公开 GitHub 仓库。
2. 打开 Altare 控制台 https://console.altare.gg/ → **Apps** → **New app**。
3. 粘贴 GitHub 仓库地址，选 **Node.js** 运行时，地区建议选离用户近的，尺寸选最小档即可（本站是轻量应用，内存几百 MB 足够）。
4. **健康检查路径填 `/health`**；启动命令用默认的 `npm start`（即 `node server.js`）。
5. 点部署。每次往仓库 `push` 新提交，Altare 会自动重新部署。

部署后在 Altare 控制台的应用详情页能看到公开访问地址；打开后应能看到报纸风格首页和最新文章。

## 目录结构

```
tech-news/
├── package.json        # "start": "node server.js"，engines: node >=20
├── server.js           # RSS 拉取 + 缓存 + 分类 + HTTP 接口
├── index.html          # 报纸风格首页（样式+脚本内联）
├── data/
│   └── cache.json      # 运行时自动生成的文章缓存（不用提交）
└── README.md
```
