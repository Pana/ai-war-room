import { kvGet, kvSet } from '../db.ts';
import { mapLimit } from '../lib/http.ts';
import { decodeXml } from '../lib/text.ts';
import type { Item } from '../types.ts';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

// 这些站点的页面会拦截抓取，或者链接本身不是文章（讨论页），不浪费请求
const SKIP = /(^|\.)(news\.ycombinator\.com|producthunt\.com|openai\.com|x\.com|twitter\.com|reddit\.com)$/i;

/** 从页面 HTML 里取分享封面图（og:image / twitter:image）。 */
function findOgImage(html: string, pageUrl: string): string | undefined {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    if (!/(?:property|name)\s*=\s*["'](?:og:image(?::url|:secure_url)?|twitter:image(?::src)?)["']/i.test(tag)) continue;
    const content = tag.match(/content\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!content) continue;
    try {
      const abs = new URL(decodeXml(content.trim()), pageUrl).toString();
      if (/^https?:/i.test(abs)) return abs;
    } catch {
      // 地址不合法，看下一个
    }
  }
  return undefined;
}

async function fetchOgImage(url: string): Promise<string | undefined> {
  const res = await fetch(url, {
    headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml', 'accept-language': 'en-US,en;q=0.9' },
    signal: AbortSignal.timeout(10_000),
    redirect: 'follow',
  });
  if (!res.ok || !/html/i.test(res.headers.get('content-type') ?? '')) return undefined;
  // 封面图在 <head> 里，只读前 400KB
  const reader = res.body!.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < 400_000) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
  }
  reader.cancel().catch(() => {});
  return findOgImage(new TextDecoder().decode(Buffer.concat(chunks)), res.url || url);
}

/**
 * 给条目补配图。preferPage = true 时优先用原文的封面图（通常比订阅源里的缩略图大、清晰），
 * 取不到再用订阅源自带的图。结果按网址缓存，同一篇文章只抓一次。
 */
export async function attachImages(items: Item[], preferPage = true): Promise<void> {
  const unique = [...new Map(items.map((it) => [it.url, it])).values()];
  let fetched = 0;
  let found = 0;
  await mapLimit(unique, 8, async (it) => {
    if (it.image && !preferPage) return;
    let host = '';
    try {
      host = new URL(it.url).hostname;
    } catch {
      return;
    }
    if (SKIP.test(host)) return;
    const key = `og:${it.url}`;
    let og = kvGet<string>(key);
    if (og === undefined) {
      fetched++;
      try {
        og = (await fetchOgImage(it.url)) ?? '';
      } catch {
        og = '';
      }
      kvSet(key, og); // 取不到也记下来（空字符串），避免每天重复请求
    }
    if (og) {
      it.image = og;
      found++;
    }
  });
  // 同一网址可能对应多个对象（不同列表里），把结果同步过去
  const byUrl = new Map(unique.map((it) => [it.url, it.image]));
  for (const it of items) if (!it.image) it.image = byUrl.get(it.url);
  if (fetched) console.log(`  · 配图：新抓取 ${fetched} 个页面，${found} 条用上了原文封面图`);
}
