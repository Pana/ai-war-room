import { fetchFeed } from '../lib/feed.ts';
import { fetchJson, fetchText, sleep } from '../lib/http.ts';
import { runSource } from '../lib/run.ts';
import { normName, num, titleOverlap, truncate } from '../lib/text.ts';
import { daysAgo } from '../config.ts';
import { kvGet, kvSet, saveEnrichment, upsertItems } from '../db.ts';
import { enrichItems } from '../pipeline/enrich.ts';
import { PODCAST_SEEDS, PODCAST_YOUTUBE } from '../sources.ts';
import type { Item, RawItem } from '../types.ts';

interface Show {
  norm: string;
  name: string;
  url: string;
  description?: string;
  publisher?: string;
  appleId?: string;
  appleRank?: number;
  spotifyRank?: number;
  spotifyMove?: string;
  seed?: boolean;
  image?: string;
}

/** Apple Podcasts 美区科技榜 Top 50。 */
async function appleChart(): Promise<Show[]> {
  const data = await fetchJson<any>('https://itunes.apple.com/us/rss/toppodcasts/limit=50/genre=1318/json');
  const entries: any[] = data?.feed?.entry ?? [];
  return entries.map((e, i): Show => {
    const name = String(e['im:name']?.label ?? '');
    const link = Array.isArray(e.link) ? e.link[0] : e.link;
    return {
      norm: normName(name),
      name,
      url: String(link?.attributes?.href ?? e.id?.label ?? ''),
      description: e.summary?.label,
      publisher: e['im:artist']?.label,
      appleId: e.id?.attributes?.['im:id'],
      appleRank: i + 1,
      // 封面有几种尺寸，取最大的一张
      image: (e['im:image'] ?? []).at(-1)?.label?.replace(/\/\d+x\d+bb\./, '/600x600bb.'),
    };
  });
}

/** Spotify 美区科技榜。这是榜单网页自己用的接口，没有公开文档，可能变动。 */
async function spotifyChart(): Promise<Show[]> {
  const list = await fetchJson<any[]>('https://podcastcharts.byspotify.com/api/charts/technology?region=us');
  return list.map((e, i): Show => {
    const name = String(e.showName ?? '');
    return {
      norm: normName(name),
      name,
      url: `https://open.spotify.com/show/${String(e.showUri ?? '').split(':').pop()}`,
      description: e.showDescription,
      publisher: e.showPublisher,
      spotifyRank: i + 1,
      spotifyMove: e.chartRankMove,
      image: e.showImageUrl,
    };
  });
}

interface AppleShow {
  appleId: string;
  name: string;
  url: string;
  publisher?: string;
}

/** 按名字在 Apple Podcasts 里找节目，结果长期缓存。 */
async function searchApple(name: string): Promise<AppleShow | undefined> {
  const key = `apple_search:${name.toLowerCase()}`;
  const cached = kvGet<AppleShow>(key);
  if (cached) return cached;
  await sleep(1200); // iTunes 搜索接口大约每分钟 20 次
  const data = await fetchJson<any>(
    `https://itunes.apple.com/search?media=podcast&entity=podcast&country=US&limit=1&term=${encodeURIComponent(name)}`,
  );
  const r = data?.results?.[0];
  if (!r?.collectionId) return undefined;
  const found: AppleShow = {
    appleId: String(r.collectionId),
    name: r.collectionName,
    url: r.collectionViewUrl,
    publisher: r.artistName,
  };
  kvSet(key, found);
  return found;
}

/** 合并两个榜单和手工名单，同一档节目按归一化名字对齐。 */
async function gatherShows(): Promise<Show[]> {
  const [apple, spotify] = await Promise.all([
    runSource('Apple Podcasts 科技榜', appleChart),
    runSource('Spotify 科技榜', spotifyChart),
  ]);
  const byNorm = new Map<string, Show>();
  const merge = (s: Show) => {
    if (!s.norm) return;
    const prev = byNorm.get(s.norm);
    // 先到的（Apple）优先保留链接和简介，后到的只补缺失字段
    byNorm.set(s.norm, prev ? { ...s, ...Object.fromEntries(Object.entries(prev).filter(([, v]) => v != null)) } : s);
  };
  apple.forEach(merge);
  spotify.forEach(merge);

  const seeds = await runSource('播客精选名单', async () => {
    const out: Show[] = [];
    for (const seed of PODCAST_SEEDS) {
      try {
        const hit = await searchApple(seed);
        if (hit) out.push({ norm: normName(hit.name), name: hit.name, url: hit.url, publisher: hit.publisher, appleId: hit.appleId });
        else console.log(`  ! 精选名单里的「${seed}」在 Apple Podcasts 没搜到`);
      } catch (err) {
        console.log(`  ! 搜索「${seed}」失败: ${(err as Error).message}`);
      }
    }
    return out;
  });
  for (const s of seeds) {
    merge(s);
    byNorm.get(s.norm)!.seed = true;
  }
  return [...byNorm.values()];
}

const bestRank = (it: Item) =>
  Math.min(Number(it.metrics?.appleRank ?? 999), Number(it.metrics?.spotifyRank ?? 999));

/** 取一档节目最近的几集。 */
async function latestEpisodes(show: Item): Promise<RawItem[]> {
  let appleId = show.extra?.appleId as string | undefined;
  if (!appleId) appleId = (await searchApple(show.title))?.appleId;
  if (!appleId) return [];
  const data = await fetchJson<any>(
    `https://itunes.apple.com/lookup?id=${appleId}&entity=podcastEpisode&limit=5&country=US`,
  );
  const since = daysAgo(10).toISOString();
  return ((data?.results ?? []) as any[])
    .filter((r) => r.wrapperType === 'podcastEpisode' && r.releaseDate >= since)
    .map(
      (r): RawItem => ({
        source: show.title,
        category: 'podcast',
        url: r.trackViewUrl,
        key: `ep:${r.trackId}`,
        title: r.trackName,
        text: truncate(String(r.description ?? r.shortDescription ?? ''), 600),
        publishedAt: r.releaseDate,
        image: r.artworkUrl600 ?? show.image,
        metrics: {
          minutes: r.trackTimeMillis ? Math.round(r.trackTimeMillis / 60000) : null,
          appleRank: show.metrics?.appleRank,
          spotifyRank: show.metrics?.spotifyRank,
        },
        extra: { showNorm: normName(show.title) },
      }),
    );
}

interface YtVideo {
  title: string;
  url: string;
  views: number;
  published?: string;
}

async function youtubeVideos(handle: string): Promise<YtVideo[]> {
  const key = `yt_channel:${handle.toLowerCase()}`;
  let channelId = kvGet<string>(key);
  if (!channelId) {
    const html = await fetchText(`https://www.youtube.com/@${handle}`, { headers: { cookie: 'CONSENT=YES+1' } });
    channelId = (html.match(/channel_id=(UC[\w-]{22})/) ?? html.match(/"externalId":"(UC[\w-]{22})"/))?.[1];
    if (!channelId) throw new Error(`没找到 @${handle} 的频道 ID`);
    kvSet(key, channelId);
  }
  const entries = await fetchFeed(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`);
  return entries.map((e) => ({
    title: e.title,
    url: e.link,
    views: num(e.raw['media:group']?.['media:community']?.['media:statistics']?.['@_views']),
    published: e.date,
  }));
}

/** 给单集补上 YouTube 观看数：按标题相似度和发布时间把单集对上视频。 */
async function attachViews(episodes: Item[]): Promise<Item[]> {
  const byHandle = new Map<string, Item[]>();
  for (const ep of episodes) {
    const norm = String(ep.extra?.showNorm ?? '');
    const handle = PODCAST_YOUTUBE.find(([prefix]) => norm.startsWith(prefix))?.[1];
    if (handle) byHandle.set(handle, [...(byHandle.get(handle) ?? []), ep]);
  }
  const matched: Item[] = [];
  const errors: string[] = [];
  for (const [handle, eps] of byHandle) {
    try {
      const videos = await youtubeVideos(handle);
      for (const ep of eps) {
        const t = new Date(ep.publishedAt ?? 0).getTime();
        const best = videos
          .map((v) => ({ v, score: titleOverlap(ep.title, v.title) }))
          .filter(({ v, score }) => score >= 0.5 && Math.abs(new Date(v.published ?? 0).getTime() - t) < 7 * 86400_000)
          .sort((a, b) => b.score - a.score)[0]?.v;
        if (!best) continue;
        ep.metrics = { ...ep.metrics, views: best.views };
        ep.extra = { ...ep.extra, youtubeUrl: best.url };
        const vid = best.url.match(/[?&]v=([\w-]{11})/)?.[1];
        if (vid) ep.image = `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`;
        matched.push(ep);
      }
    } catch (err) {
      errors.push(`@${handle}: ${(err as Error).message}`);
    }
  }
  if (errors.length) console.log(`  ! YouTube 部分频道失败: ${errors.join('; ')}`);
  if (byHandle.size && errors.length === byHandle.size) throw new Error(errors.join('; '));
  return matched;
}

export async function collectPodcasts(): Promise<{ shows: Item[]; episodes: Item[] }> {
  // 1. 节目池：榜单 + 精选名单，由 LLM 判断哪些是 AI 节目
  const shows = upsertItems(
    (await gatherShows()).map(
      (s): RawItem => ({
        source: '播客节目',
        category: 'podcast_show',
        url: s.url,
        key: s.norm,
        title: s.name,
        text: truncate(s.description ?? '', 400),
        image: s.image,
        metrics: { appleRank: s.appleRank, spotifyRank: s.spotifyRank },
        extra: { appleId: s.appleId, spotifyMove: s.spotifyMove, publisher: s.publisher, seed: s.seed },
      }),
    ),
  );
  await enrichItems(
    shows,
    '这档播客是否以 AI 为主要话题，或经常深入讨论 AI（泛科技、创投类但常聊 AI 的也算 true；与 AI 基本无关的为 false）',
  );
  for (const s of shows) {
    if (s.extra?.seed && s.ai !== true) {
      s.ai = true;
      saveEnrichment(s.id, true, s.titleZh, s.summaryZh);
    }
  }
  const aiShows = shows
    .filter((s) => s.ai)
    .sort((a, b) => bestRank(a) - bestRank(b))
    .slice(0, 30);

  // 2. 这些节目最近的单集，再由 LLM 判断单集是否在讲 AI
  const rawEpisodes = await runSource('Apple Podcasts 单集', async () => {
    const out: RawItem[] = [];
    const errors: string[] = [];
    for (const show of aiShows) {
      try {
        out.push(...(await latestEpisodes(show)));
      } catch (err) {
        errors.push(`${show.title}: ${(err as Error).message}`);
      }
      await sleep(700);
    }
    if (errors.length) console.log(`  ! 部分节目取单集失败: ${errors.join('; ')}`);
    if (aiShows.length && errors.length === aiShows.length) throw new Error(errors.join('; '));
    return out;
  });
  const episodes = upsertItems(rawEpisodes);
  await enrichItems(episodes, '这一集的内容是否主要与 AI 相关');
  const aiEpisodes = episodes.filter((e) => e.ai);

  // 3. 单集的 YouTube 观看数
  await runSource('YouTube 观看数', () => attachViews(aiEpisodes));

  return { shows: aiShows, episodes: aiEpisodes };
}
