import { config, daysAgo, hoursAgo, reportDate } from './config.ts';
import { earlierSnapshot, saveReport, saveSnapshot, shownNewsUrls, upsertItems } from './db.ts';
import { llmConfigured, llmErrors } from './lib/llm.ts';
import { runSource, statuses } from './lib/run.ts';
import { hackerNews, showHn, techcrunch, techmeme, theVerge } from './collectors/news.ts';
import { anthropicEngineering, anthropicNews, officialFeed } from './collectors/official.ts';
import { hfModels, hfSpaces, productHunt } from './collectors/products.ts';
import { freshRepos, trendingDaily, trendingWeekly } from './collectors/github.ts';
import { collectPodcasts } from './collectors/podcasts.ts';
import { acdCalls, clientReleases, ecoFeed, eipUpdates, ethresearchTop, magiciansTop } from './collectors/ethereum.ts';
import { enrichItems, summarizeCalls } from './pipeline/enrich.ts';
import { buildTopNews, ETH_TOP, newsScore } from './pipeline/topnews.ts';
import { attachImages } from './pipeline/images.ts';
import { looksEth } from './lib/text.ts';
import { ETH_NEWS_FEEDS, OFFICIAL_FEEDS } from './sources.ts';
import type { Item, Report } from './types.ts';

const date = reportDate();
console.log(`\n== AI 动态采集 ${date} ==`);
console.log(
  llmConfigured()
    ? `LLM: ${config.llm.model}（${config.llm.format} 格式）`
    : 'LLM: 未配置 —— 本次没有中文摘要，AI 相关性用关键词判断',
);

// ---------- 1. 采集 ----------
console.log('\n[1/5] AI 采集');
const [tm, hn, tc, verge, anNews, anEng, ph, shn, spaces, models, ghDaily, ghWeekly, ghFresh, ...feeds] =
  await Promise.all([
    runSource('Techmeme', techmeme),
    runSource('Hacker News', hackerNews),
    runSource('TechCrunch', techcrunch),
    runSource('The Verge', theVerge),
    runSource('Anthropic', anthropicNews),
    runSource('Anthropic Engineering', anthropicEngineering),
    runSource('Product Hunt', productHunt),
    runSource('Show HN', showHn),
    runSource('HF Spaces', hfSpaces),
    runSource('HF Models', hfModels),
    runSource('GitHub Trending 日榜', trendingDaily),
    runSource('GitHub Trending 周榜', trendingWeekly),
    runSource('GitHub 新项目', freshRepos),
    ...OFFICIAL_FEEDS.map((f) => runSource(f.source, officialFeed(f.source, f.url))),
  ]);

const news = upsertItems([...tm, ...hn, ...tc, ...verge]);
const official = upsertItems([...feeds.flat(), ...anNews, ...anEng]);
const phItems = upsertItems(ph);
const shnItems = upsertItems(shn);
const hfSpaceItems = upsertItems(spaces);
const hfModelItems = upsertItems(models);
const daily = upsertItems(ghDaily);
const weekly = upsertItems(ghWeekly);
const fresh = upsertItems(ghFresh);

// ---------- 2. LLM 加工：AI 相关性 + 中文标题摘要 ----------
console.log('\n[2/5] LLM 加工');
await enrichItems(news, '这条新闻是否与 AI 相关（模型、AI 产品、AI 公司、AI 芯片与算力、AI 政策与安全、AI 研究等）');
// 官方博客只取近 7 天的做中文摘要，避免首次运行把历史文章全翻一遍
const recentOfficial = official.filter((it) => !it.publishedAt || it.publishedAt >= daysAgo(7).toISOString());
await enrichItems(recentOfficial, '这是 AI 公司的官方博客文章，ai 一律为 true');
await enrichItems([...phItems, ...shnItems], '这个产品是否是 AI 产品，或以 AI 为核心卖点');
await enrichItems(
  [...daily, ...weekly, ...fresh],
  '这个 GitHub 仓库是否与 AI 相关（LLM、Agent、模型训练与推理、AI 应用与开发工具、MCP、提示词或技能集合等）',
);
// Hugging Face 上的本来就是模型和 Demo，不需要判断
for (const it of [...hfSpaceItems, ...hfModelItems]) it.ai = true;

// GitHub star 快照：存下今天的数，并用历史快照算自己的增量
const snapSince = daysAgo(8).toISOString().slice(0, 10);
for (const it of [...daily, ...weekly, ...fresh]) {
  const stars = Number(it.metrics?.stars ?? 0);
  if (!stars) continue;
  saveSnapshot(it.title, date, stars);
  const prev = earlierSnapshot(it.title, date, snapSince);
  if (prev) {
    const days = Math.round((new Date(date).getTime() - new Date(prev.date).getTime()) / 86400_000);
    it.metrics = { ...it.metrics, ownGain: stars - prev.stars, ownGainDays: days };
  }
}

// ---------- 3. Podcast ----------
console.log('\n[3/5] Podcast');
const podcasts = await collectPodcasts();

// ---------- 4. 以太坊 ----------
console.log('\n[4/5] 以太坊');
const [calls, magTop, resTop, eips, releases, ...ecoLists] = await Promise.all([
  runSource('ACD 核心开发者会议', acdCalls),
  runSource('Ethereum Magicians', magiciansTop),
  runSource('ethresear.ch', ethresearchTop),
  runSource('EIP 更新', eipUpdates),
  runSource('以太坊客户端发布', clientReleases),
  ...ETH_NEWS_FEEDS.map((f) => runSource(f.source, ecoFeed(f))),
]);
const callItems = upsertItems(calls);
const researchItems = upsertItems([...magTop, ...resTop]);
const eipItems = upsertItems(eips);
const releaseItems = upsertItems(releases);
const ecoItems = upsertItems(ecoLists.flat());

await summarizeCalls(callItems);
const keep = () => true;
await enrichItems(
  [...researchItems, ...eipItems, ...releaseItems, ...ecoItems.filter((it) => it.extra?.always)],
  '这是以太坊协议与生态的内容（技术论坛帖、EIP 改动、客户端发布、以太坊基金会博客等），ai 一律为 true',
  keep,
);
await enrichItems(
  ecoItems.filter((it) => !it.extra?.always),
  '这条新闻是否与以太坊生态相关（以太坊协议与升级、L2、以太坊上的 DeFi 与重要项目、质押、安全事件、ETH 相关的监管与机构动向）；泛加密行情、比特币或其他公链的新闻为 false',
  (it) => looksEth(`${it.title} ${it.text ?? ''}`),
);
// 前几天报告里已经出现过的新闻不再放进今天的要闻和新闻列表（官方博客、榜单类栏目不受影响）。
// 回看 14 天，覆盖所有新闻源里最长的时间窗口（以太坊基金会博客等）。
const shownBefore = shownNewsUrls(date, daysAgo(14).toISOString().slice(0, 10));
const unseen = (it: Item) => !shownBefore.has(it.url);

const ecoNews = ecoItems.filter((it) => it.ai && unseen(it)).sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''));

// ---------- 5. 生成报告 ----------
console.log('\n[5/5] 生成报告');
const since36h = hoursAgo(36).toISOString();
const isRecent = (it: Item) => !it.publishedAt || it.publishedAt >= since36h;
const aiNews = news.filter((it) => it.ai && unseen(it)).sort((a, b) => newsScore(b) - newsScore(a));
// 配图：新闻优先用原文封面图；官方博客和以太坊新闻的订阅源自带图就够用，缺图的才去原文页面取
await attachImages(aiNews.slice(0, 60));
await attachImages([...official.slice(0, 40), ...ecoNews.slice(0, 40)], false);
const topNews = await buildTopNews([
  ...aiNews.filter(isRecent),
  ...official.filter((it) => unseen(it) && it.publishedAt && it.publishedAt >= since36h),
]);
console.log(`  前几天报告里的新闻链接 ${shownBefore.size} 个，已从今天的要闻和新闻里排除`);

const since48h = hoursAgo(48).toISOString();
const ethTop = await buildTopNews(
  ecoNews.filter((it) => (it.publishedAt ?? '') >= since48h),
  ETH_TOP,
);

const byMetric = (key: string) => (a: Item, b: Item) => Number(b.metrics?.[key] ?? 0) - Number(a.metrics?.[key] ?? 0);
const since7d = daysAgo(7).toISOString();

const report: Report = {
  date,
  generatedAt: new Date().toISOString(),
  llm: { configured: llmConfigured(), model: config.llm.model, errors: [...new Set(llmErrors)].slice(0, 5) },
  sources: statuses,
  topNews,
  news: aiNews.slice(0, 40),
  official: [...official].sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? '')).slice(0, 40),
  products: {
    productHunt: phItems.filter((it) => it.ai).slice(0, 25),
    showHn: shnItems.filter((it) => it.ai).sort(byMetric('points')).slice(0, 15),
    hfSpaces: hfSpaceItems,
    hfModels: hfModelItems,
  },
  github: {
    daily: daily.filter((it) => it.ai).sort(byMetric('gained')),
    weekly: weekly.filter((it) => it.ai).sort(byMetric('gained')),
    fresh: fresh.filter((it) => it.ai).sort(byMetric('stars')).slice(0, 30),
  },
  podcasts: {
    episodes: podcasts.episodes
      .filter((e) => (e.publishedAt ?? '') >= since7d)
      // 有观看数的按观看数排前面，其余按节目榜单名次
      .sort(
        (a, b) =>
          Number(b.metrics?.views ?? -1) - Number(a.metrics?.views ?? -1) ||
          Math.min(Number(a.metrics?.appleRank ?? 999), Number(a.metrics?.spotifyRank ?? 999)) -
            Math.min(Number(b.metrics?.appleRank ?? 999), Number(b.metrics?.spotifyRank ?? 999)),
      ),
    shows: podcasts.shows,
  },
  ethereum: {
    top: ethTop,
    calls: callItems,
    research: researchItems.sort(byMetric('views')),
    eips: eipItems.sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? '')),
    releases: releaseItems,
    news: ecoNews.slice(0, 40),
  },
};
saveReport(report);

const failed = statuses.filter((s) => !s.ok);
console.log(`\n完成：${statuses.length - failed.length}/${statuses.length} 个数据源成功`);
for (const f of failed) console.log(`  失败 ${f.source}: ${f.error}`);
if (report.llm.errors.length) console.log(`  LLM 出错 ${llmErrors.length} 次，例如: ${report.llm.errors[0]}`);
console.log(
  `Top 新闻 ${topNews.length} · 新闻 ${report.news.length} · 官方博客 ${report.official.length} · ` +
    `产品 ${report.products.productHunt.length + report.products.showHn.length} · ` +
    `GitHub ${report.github.daily.length}/${report.github.weekly.length}/${report.github.fresh.length} · ` +
    `Podcast 单集 ${report.podcasts.episodes.length} · ` +
    `以太坊 会议 ${callItems.length}/研究 ${researchItems.length}/EIP ${eipItems.length}/发布 ${releaseItems.length}/新闻 ${ecoNews.length}`,
);
console.log(`\n查看：npm run web  →  http://localhost:${config.port}\n`);
