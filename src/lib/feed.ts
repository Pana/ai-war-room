import { XMLParser } from 'fast-xml-parser';
import { fetchText } from './http.ts';
import { decodeXml, plain, toIso } from './text.ts';

// 实体不交给解析器展开：大 feed 会触发它的展开上限，我们自己解码。
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  processEntities: false,
  parseTagValue: false,
  trimValues: true,
});

export interface FeedEntry {
  title: string;
  link: string;
  date?: string;
  /** 原始简介（可能含 HTML）。 */
  html: string;
  /** 纯文本简介。 */
  text: string;
  /** 条目自带的图片。 */
  image?: string;
  raw: Record<string, any>;
}

/** 从订阅源条目里找图：media:content / media:thumbnail / enclosure / itunes:image，最后是正文里的第一张 <img>。 */
function entryImage(it: any, html: string, base: string): string | undefined {
  const candidates: unknown[] = [];
  const group = it['media:group'] ?? {};
  for (const src of [it['media:content'], group['media:content'], it['media:thumbnail'], group['media:thumbnail']]) {
    for (const m of arr(src as any)) {
      if (!m || typeof m !== 'object') continue;
      const type = String((m as any)['@_type'] ?? (m as any)['@_medium'] ?? '');
      if (type && !/image/i.test(type)) continue;
      candidates.push((m as any)['@_url']);
    }
  }
  for (const enc of arr(it.enclosure)) {
    if (enc && /image/i.test(String((enc as any)['@_type'] ?? ''))) candidates.push((enc as any)['@_url']);
  }
  for (const link of arr(it.link)) {
    if (link && typeof link === 'object' && (link as any)['@_rel'] === 'enclosure' && /image/i.test(String((link as any)['@_type'] ?? ''))) {
      candidates.push((link as any)['@_href']);
    }
  }
  candidates.push(it['itunes:image']?.['@_href']);
  candidates.push(html.match(/<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/i)?.[1]);

  for (const c of candidates) {
    if (typeof c !== 'string' || !c.trim()) continue;
    try {
      const abs = new URL(decodeXml(c.trim()), base || undefined).toString().replace(/^http:\/\//i, 'https://');
      if (/^https:\/\//i.test(abs)) return abs;
    } catch {
      // 看下一个
    }
  }
  return undefined;
}

const str = (v: unknown): string =>
  typeof v === 'string' ? v : v && typeof v === 'object' ? String((v as any)['#text'] ?? '') : v == null ? '' : String(v);

const arr = <T>(v: T | T[] | undefined): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);

function atomLink(link: unknown): string {
  const links = arr(link as any);
  const pick = links.find((l: any) => typeof l === 'object' && (l['@_rel'] ?? 'alternate') === 'alternate') ?? links[0];
  return typeof pick === 'string' ? pick : String(pick?.['@_href'] ?? '');
}

export function parseFeed(xml: string): FeedEntry[] {
  const doc = parser.parse(xml);
  const rssItems = arr(doc?.rss?.channel?.item ?? doc?.['rdf:RDF']?.item);
  const atomEntries = arr(doc?.feed?.entry);

  const fromRss = rssItems.map((it: any): FeedEntry => {
    const html = decodeXml(str(it['content:encoded']) || str(it.description));
    const link = decodeXml(str(it.link)).trim();
    return {
      title: plain(str(it.title)),
      link,
      date: toIso(str(it.pubDate) || str(it['dc:date'])),
      html,
      text: plain(html),
      image: entryImage(it, html, link),
      raw: it,
    };
  });

  const fromAtom = atomEntries.map((it: any): FeedEntry => {
    const html = decodeXml(str(it.content) || str(it.summary) || str(it['media:group']?.['media:description']));
    const link = decodeXml(atomLink(it.link)).trim();
    return {
      title: plain(str(it.title)),
      link,
      date: toIso(str(it.published) || str(it.updated)),
      html,
      text: plain(html),
      image: entryImage(it, html, link),
      raw: it,
    };
  });

  return [...fromRss, ...fromAtom].filter((e) => e.title && e.link);
}

export async function fetchFeed(url: string): Promise<FeedEntry[]> {
  return parseFeed(await fetchText(url, { timeoutMs: 30_000 }));
}
