import { fetchFeed } from '../lib/feed.ts';
import { fetchJson } from '../lib/http.ts';
import { truncate } from '../lib/text.ts';
import { hoursAgo } from '../config.ts';
import type { RawItem } from '../types.ts';

/** Techmeme：feed 顺序即编辑排的热度。标题形如 "Headline (Author/Source)"。 */
export async function techmeme(): Promise<RawItem[]> {
  const entries = await fetchFeed('https://www.techmeme.com/feed.xml');
  return entries.map((e, i): RawItem => {
    const m = e.title.match(/^(.*)\s\(([^()]+)\)$/);
    const original = e.html.match(/HREF="(https?:\/\/(?!www\.techmeme\.com)[^"]+)"/i)?.[1];
    return {
      source: 'Techmeme',
      category: 'news',
      url: original ?? e.link,
      title: m?.[1] ?? e.title,
      // 简介形如 "作者 / 媒体: 标题 — 正文摘录"，只留正文摘录
      text: truncate(e.text.split(' — ').slice(1).join(' — ') || '', 500),
      publishedAt: e.date,
      image: e.image,
      metrics: { rank: i + 1 },
      extra: { via: m?.[2], techmemeUrl: e.link },
    };
  });
}

interface HnHit {
  objectID: string;
  title: string;
  url?: string;
  points: number;
  num_comments: number;
  created_at: string;
}

async function hnSearch(tags: string, hours: number, minPoints: number, source: string): Promise<RawItem[]> {
  const since = Math.floor(hoursAgo(hours).getTime() / 1000);
  const url =
    `https://hn.algolia.com/api/v1/search?tags=${tags}&hitsPerPage=100` +
    `&numericFilters=${encodeURIComponent(`created_at_i>${since},points>${minPoints}`)}`;
  const data = await fetchJson<{ hits: HnHit[] }>(url);
  return data.hits
    .filter((h) => h.title)
    .map((h): RawItem => {
      const discussion = `https://news.ycombinator.com/item?id=${h.objectID}`;
      return {
        source,
        category: source === 'Show HN' ? 'product' : 'news',
        url: h.url || discussion,
        key: `hn:${h.objectID}`,
        title: h.title,
        publishedAt: h.created_at,
        metrics: { points: h.points, comments: h.num_comments },
        extra: { discussion },
      };
    });
}

/** Hacker News 过去 24 小时的高分帖。 */
export const hackerNews = () => hnSearch('story', 24, 80, 'Hacker News');

/** Show HN 过去 48 小时的高分帖（归入产品）。 */
export const showHn = () => hnSearch('show_hn', 48, 30, 'Show HN');

function mediaFeed(source: string, url: string) {
  return async (): Promise<RawItem[]> => {
    const since = hoursAgo(48).toISOString();
    return (await fetchFeed(url))
      .filter((e) => !e.date || e.date >= since)
      .map(
        (e): RawItem => ({
          source,
          category: 'news',
          url: e.link,
          title: e.title,
          text: truncate(e.text, 500),
          publishedAt: e.date,
          image: e.image,
        }),
      );
  };
}

export const techcrunch = mediaFeed('TechCrunch', 'https://techcrunch.com/category/artificial-intelligence/feed/');
export const theVerge = mediaFeed('The Verge', 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml');
