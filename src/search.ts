/**
 * 搜索索引：把最近几天报告里展示过的条目整理成一份精简的 JSON，交给页面在浏览器里搜。
 * 网站是静态发布的（GitHub Pages 上没有服务器能查 SQLite），所以本地服务和静态导出都用这份索引，
 * 地址同为 api/search.json。
 */
import { loadReport, reportDates } from './db.ts';
import { truncate } from './lib/text.ts';
import type { Item, Report, TopNewsEntry } from './types.ts';

export interface SearchEntry {
  /** 标题（有中文标题就用中文）。 */
  t: string;
  /** 原标题，和 t 不同时才有。 */
  o?: string;
  /** 摘要。 */
  s: string;
  src: string;
  u: string;
  /** 发布时间。 */
  w?: string;
  img?: string;
  /** 只用来匹配、不展示的文字（要闻里各篇报道的原标题）。 */
  x?: string;
  /** 所在报告的日期、栏目 id（和页面里的栏目 id 一致）、在栏目里的位置。 */
  d: string;
  sec: string;
  i: number;
}

const fromItem = (it: Item, d: string, sec: string, i: number): SearchEntry => {
  const zh = it.titleZh && it.titleZh !== it.title;
  return {
    t: zh ? it.titleZh! : it.title,
    o: zh ? it.title : undefined,
    s: it.summaryZh || truncate(it.text ?? '', 300),
    src: it.source,
    u: it.url,
    w: it.publishedAt,
    img: it.image,
    d,
    sec,
    i,
  };
};

const fromTop = (n: TopNewsEntry, d: string, sec: string, i: number): SearchEntry => ({
  t: n.title,
  s: n.summary,
  src: n.links.map((l) => l.source).join(' · '),
  u: n.links[0]?.url ?? '',
  img: n.image,
  x: n.links.map((l) => l.title).join(' / '),
  d,
  sec,
  i,
});

/** 一份报告里可搜的栏目，顺序和 id 跟 public/index.html 的 buildSections 对应。 */
function reportEntries(r: Report): SearchEntry[] {
  const e = r.ethereum;
  const items: [string, Item[]][] = [
    ['news', r.news],
    ['official', r.official],
    ['ph', r.products.productHunt],
    ['showhn', r.products.showHn],
    ['hf', [...r.products.hfModels, ...r.products.hfSpaces]],
    ['gh', r.github.daily],
    ['ghw', r.github.weekly],
    ['ghn', r.github.fresh],
    ['pod', r.podcasts.episodes],
    ['calls', e?.calls ?? []],
    ['research', e?.research ?? []],
    ['eips', e?.eips ?? []],
    ['rel', e?.releases ?? []],
    ['enews', e?.news ?? []],
  ];
  return [
    ...r.topNews.map((n, i) => fromTop(n, r.date, 'top', i)),
    ...(e?.top ?? []).map((n, i) => fromTop(n, r.date, 'etop', i)),
    ...items.flatMap(([sec, list]) => list.map((it, i) => fromItem(it, r.date, sec, i))),
  ];
}

/**
 * 最近 days 天报告的搜索索引，新的在前。同一个链接在多天出现时（官方博客、GitHub 榜单等）只保留最近一次；
 * 要闻按「日期 + 位置」区分，因为不同天的要闻可能以同一篇报道打头。
 */
export function buildSearchIndex(days: number): SearchEntry[] {
  const seen = new Set<string>();
  const out: SearchEntry[] = [];
  for (const date of reportDates().slice(0, days)) {
    const r = loadReport(date);
    if (!r) continue;
    for (const entry of reportEntries(r)) {
      const key = entry.sec === 'top' || entry.sec === 'etop' ? `${entry.sec}:${entry.d}:${entry.i}` : entry.u;
      if (!entry.u || seen.has(key)) continue;
      seen.add(key);
      out.push(entry);
    }
  }
  return out;
}
