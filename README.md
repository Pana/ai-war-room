# AI 作战室

每天采集海外 AI 动态和以太坊协议/生态动态，LLM 过滤、去重并生成中文摘要，在本地网页查看。

## 使用

```bash
npm install
cp .env.example .env   # 填 LLM 地址、key、模型名
npm run collect        # 采集并生成当天报告（约 1～2 分钟）
npm run web            # http://localhost:8787
```

不填 `.env` 也能跑，只是没有中文摘要，AI 相关性退化为关键词判断。配好 LLM 后再跑一次，之前没处理的条目会补上。

采集脚本会读取 `HTTPS_PROXY` / `HTTP_PROXY` 环境变量走代理。

## 内容

| 分类 | 来源 |
|---|---|
| 今日十大 | Techmeme、Hacker News、TechCrunch、The Verge、官方博客，LLM 合并同一事件后排序 |
| 官方博客 | OpenAI、Anthropic（新闻 + 工程）、Google DeepMind、Google AI |
| AI 产品 | Product Hunt、Show HN、Hugging Face 热门 Spaces 和模型 |
| GitHub | Trending 日榜 / 周榜（AI 相关）、近 30 天新建的 AI 项目 |
| Podcast | Apple / Spotify 科技榜里的 AI 节目 + 精选名单，单集按 YouTube 观看数排序 |
| 以太坊 | 核心开发者会议 ACDE / ACDC / ACDT（Forkcast 会议要点 + Ethereum Magicians 议程）、Magicians 与 ethresear.ch 本周热帖、EIP 改动、客户端发布、生态新闻（EF Blog、Ethereal news、The Defiant、Decrypt） |

网页有两个视图，读同一份报告，左上角 / 报头可互相切换，深色 / 浅色设置共用：

- `/` 三栏阅读器：左侧分类、中间列表、右侧阅读。快捷键 `J` / `K` 上下条，`[` / `]` 切换分类，`O` 打开原文。
- `/daily` 日报版面：像报纸一样一页读完。

数据源名单（官方博客、GitHub topic、播客精选和 YouTube 频道、以太坊客户端和新闻源）在 `src/sources.ts` 里改。

## 结构

- `src/collectors/` 各数据源的采集器，统一输出 `RawItem`
- `src/pipeline/` LLM 加工：AI 相关性 + 中文摘要（`enrich.ts`）、十大新闻（`topnews.ts`）
- `src/collect.ts` 采集入口，生成当天报告存入 SQLite（`data/ai.db`）
- `src/server.ts` + `public/index.html` 网页
