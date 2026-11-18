import * as cheerio from 'cheerio';
import { fetchFeed } from '../lib/feed.ts';
import { fetchText } from '../lib/http.ts';
import { toIso, truncate } from '../lib/text.ts';
import { daysAgo } from '../config.ts';
import type { RawItem } from '../types.ts';

/** 官方博客 RSS：取近 14 天、最多 25 篇。 */
export function officialFeed(source: string, url: string) {
  return async (): Promise<RawItem[]> => {
    const since = daysAgo(14).toISOString();
    return (await fetchFeed(url))
      .filter((e) => e.date && e.date >= since)
      .sort((a, b) => b.date!.localeCompare(a.date!))
      .slice(0, 25)
      .map(
        (e): RawItem => ({
          source,
          category: 'official',
          url: e.link,
          title: e.title,
          text: truncate(e.text, 500),
          publishedAt: e.date,
          image: e.image,
        }),
      );
  };
}

/**
 * Anthropic 没有 RSS，直接解析列表页。
 * 页面上每篇文章是一个指向 /news/slug 或 /engineering/slug 的链接，
 * 标题在链接内的标题标签里，日期在同一张卡片的 <time> 里。
 */
async function anthropicPage(path: 'news' | 'engineering'): Promise<RawItem[]> {
  const html = await fetchText(`https://www.anthropic.com/${path}`, { timeoutMs: 30_000 });
  const $ = cheerio.load(html);
  const seen = new Map<string, RawItem>();
  // 工程博客的文章实际挂在 /research/ 下面
  const linkPrefix = path === 'news' ? '/news/' : '/research/';

  $(`a[href^="${linkPrefix}"]`).each((_, el) => {
    const a = $(el);
    const href = a.attr('href')!.split(/[?#]/)[0]!;
    if (href.startsWith('/research/team/')) return;
    const heading = a.find('h1,h2,h3,h4,h5,h6').first().text().trim();
    // 没有标题标签的链接多半是分类标签（如 /news/announcements），跳过；
    // 列表行样式的链接把标题放在带 title 字样 class 的元素里。
    const title = heading || a.find('[class*="title" i]').first().text().trim();
    if (!title) return;

    // 日期在链接里，或在外面几层的卡片容器里；容器里有多个日期时说明走过头了，放弃
    let timeText = a.find('time').first().text().trim();
    for (let p = a.parent(), depth = 0; !timeText && p.length && depth < 3; p = p.parent(), depth++) {
      const times = p.find('time');
      if (times.length > 1) break;
      if (times.length === 1) timeText = times.text().trim();
    }
    const summary = a.find('p').first().text().trim();
    const prev = seen.get(href);
    // 同一篇文章可能出现多次（头图位 + 列表），保留信息更全的那条
    if (prev && (prev.publishedAt || !timeText)) return;
    seen.set(href, {
      source: path === 'news' ? 'Anthropic' : 'Anthropic Engineering',
      category: 'official',
      url: `https://www.anthropic.com${href}`,
      title,
      text: truncate(summary || prev?.text || '', 500),
      publishedAt: toIso(timeText) ?? prev?.publishedAt,
    });
  });

  if (!seen.size) throw new Error(`Anthropic /${path} 页面没有解析出文章，页面结构可能变了`);
  return [...seen.values()];
}

export const anthropicNews = () => anthropicPage('news');
export const anthropicEngineering = () => anthropicPage('engineering');
