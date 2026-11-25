import { fetchFeed } from '../lib/feed.ts';
import { fetchJson, fetchText, mapLimit } from '../lib/http.ts';
import { plain, truncate } from '../lib/text.ts';
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
  cardData?: { title?: string; short_description?: string };
}

/**
 * 从模型卡 / Space 的 README 里取开头几段正文当简介。
 * 去掉 YAML 头、代码块、图片、表格、标题和 HF 自动生成的模板句。
 */
export function readmeIntro(md: string, max = 600): string {
  const body = md
    .replace(/^---\n[\s\S]*?\n---\n?/, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
  const paras: string[] = [];
  let len = 0;
  for (const block of body.split(/\n\s*\n/)) {
    const b = block.trim();
    if (!b || /^(#|\||>|[-*]\s|\d+\.\s)/.test(b)) continue;
    const t = plain(b).replace(/[*_`]+/g, '').trim();
    // 太短的多半是链接栏、徽章或 "License: xx" 之类的字段
    if (t.length < 40 || /configuration reference|spaces-config-reference/i.test(t)) continue;
    paras.push(t);
    len += t.length;
    if (len >= max) break;
  }
  return truncate(paras.join(' '), max);
}

async function hfIntro(kind: 'spaces' | 'models', e: HfEntry): Promise<string> {
  let intro = '';
  try {
    const path = kind === 'spaces' ? `spaces/${e.id}` : e.id;
    intro = readmeIntro(await fetchText(`https://huggingface.co/${path}/raw/main/README.md`, { timeoutMs: 10_000, retries: 0 }));
  } catch {
    // 没有 README 或私有/受限仓库，只用卡片信息
  }
  // README 开头常常就是 short_description 原句，避免重复
  const short = e.cardData?.short_description?.trim();
  const head = [e.cardData?.title, short && !intro.includes(short.replace(/[.。]$/, '')) ? short : '']
    .filter(Boolean)
    .join(' — ');
  return truncate([head, intro].filter(Boolean).join(' | '), 600);
}

function hfTrending(kind: 'spaces' | 'models') {
  return async (): Promise<RawItem[]> => {
    const list = await fetchJson<HfEntry[]>(`https://huggingface.co/api/${kind}?sort=trendingScore&limit=20&full=true`);
    const intros = await mapLimit(list, 6, (e) => hfIntro(kind, e));
    return list.map(
      (e, i): RawItem => ({
        source: kind === 'spaces' ? 'HF Spaces' : 'HF Models',
        category: 'product',
        url: `https://huggingface.co/${kind === 'spaces' ? 'spaces/' : ''}${e.id}`,
        title: e.id,
        text: intros[i] || undefined,
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
