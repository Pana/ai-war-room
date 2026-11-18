import { fetchFeed } from '../lib/feed.ts';
import { fetchJson } from '../lib/http.ts';
import { truncate } from '../lib/text.ts';
import type { RawItem } from '../types.ts';

/** Product Hunt 的公开 feed：只有名称和一句话介绍，没有票数。feed 顺序即站内展示顺序。 */
export async function productHunt(): Promise<RawItem[]> {
  const entries = await fetchFeed('https://www.producthunt.com/feed');
  return entries.map(
    (e, i): RawItem => ({
      source: 'Product Hunt',
      category: 'product',
      url: e.link,
      title: e.title,
      // 简介后面跟着 "Discussion | Link" 两个链接文字，去掉
      text: truncate(e.text.replace(/\s*Discussion\s*\|\s*Link\s*$/i, ''), 300),
      publishedAt: e.date,
      metrics: { rank: i + 1 },
    }),
  );
}

interface HfEntry {
  id: string;
  likes?: number;
  downloads?: number;
  trendingScore?: number;
  pipeline_tag?: string;
  sdk?: string;
  createdAt?: string;
}

function hfTrending(kind: 'spaces' | 'models') {
  return async (): Promise<RawItem[]> => {
    const list = await fetchJson<HfEntry[]>(`https://huggingface.co/api/${kind}?sort=trendingScore&limit=20`);
    return list.map(
      (e): RawItem => ({
        source: kind === 'spaces' ? 'HF Spaces' : 'HF Models',
        category: 'product',
        url: `https://huggingface.co/${kind === 'spaces' ? 'spaces/' : ''}${e.id}`,
        title: e.id,
        publishedAt: e.createdAt,
        metrics: {
          trending: e.trendingScore ?? 0,
          likes: e.likes ?? 0,
          downloads: e.downloads,
          tag: e.pipeline_tag ?? e.sdk,
        },
      }),
    );
  };
}

export const hfSpaces = hfTrending('spaces');
export const hfModels = hfTrending('models');
