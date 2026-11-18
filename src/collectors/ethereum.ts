import { fetchFeed } from '../lib/feed.ts';
import { fetchJson, sleep } from '../lib/http.ts';
import { plain, toIso, truncate } from '../lib/text.ts';
import { config, daysAgo, hoursAgo } from '../config.ts';
import { ETH_CLIENTS, ETH_NEWS_FEEDS } from '../sources.ts';
import type { RawItem } from '../types.ts';

const MAGICIANS = 'https://ethereum-magicians.org';
const FORKCAST_RAW = 'https://raw.githubusercontent.com/ethereum/forkcast/main/public/artifacts';

interface DiscourseTopic {
  id: number;
  slug: string;
  title: string;
  created_at: string;
  posts_count: number;
  views: number;
  like_count?: number;
}

const SERIES = {
  acde: 'ACDE 执行层',
  acdc: 'ACDC 共识层',
  acdt: 'ACDT 测试',
} as const;

/** Forkcast 为每次会议整理的要点：决议、重点、行动项、时间目标。 */
interface Tldr {
  highlights?: Record<string, { highlight: string }[]>;
  decisions?: { decision: string }[];
  action_items?: { action: string; owner?: string }[];
  targets?: { target: string }[];
}

function tldrText(t: Tldr): string {
  const block = (name: string, lines: string[]) => (lines.length ? `${name}:\n${lines.map((l) => `• ${l}`).join('\n')}` : '');
  return [
    block('Decisions', (t.decisions ?? []).map((d) => d.decision)),
    block('Highlights', Object.values(t.highlights ?? {}).flat().map((h) => h.highlight)),
    block('Action items', (t.action_items ?? []).map((a) => (a.owner ? `${a.action} (${a.owner})` : a.action))),
    block('Targets', (t.targets ?? []).map((x) => x.target)),
  ]
    .filter(Boolean)
    .join('\n\n');
}

/**
 * 核心开发者会议（ACDE / ACDC / ACDT）最近几期。
 * 议程来自以太坊魔法师论坛的会议帖；开完会后 Forkcast 会放出结构化要点，优先用它，
 * 没有的话退回论坛帖里自动生成的会议纪要。
 */
export async function acdCalls(): Promise<RawItem[]> {
  const out: RawItem[] = [];
  const errors: string[] = [];

  for (const [series, label] of Object.entries(SERIES)) {
    try {
      const list = await fetchJson<{ topic_list: { topics: DiscourseTopic[] } }>(`${MAGICIANS}/tag/${series}.json`);
      const calls = list.topic_list.topics
        .map((t) => {
          // 标题形如 "All Core Devs - Execution (ACDE) #248, October 22, 2026"
          const m = t.title.match(/#\s*(\d+)\s*,?\s*(.+)$/);
          const date = m ? toIso(`${m[2]} 14:00 UTC`) : undefined;
          return m && date ? { topic: t, number: Number(m[1]), date } : null;
        })
        .filter((x): x is NonNullable<typeof x> => !!x)
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 3);

      for (const { topic, number, date } of calls) {
        const upcoming = new Date(date).getTime() > Date.now();
        let body = '';
        let stage: 'tldr' | 'summary' | 'agenda' = 'agenda';

        if (!upcoming) {
          try {
            const tldr = await fetchJson<Tldr>(`${FORKCAST_RAW}/${series}/${date.slice(0, 10)}_${number}/tldr.json`, {
              retries: 0,
            });
            body = tldrText(tldr);
            if (body) stage = 'tldr';
          } catch {
            // 还没出要点，下面用论坛帖
          }
        }
        if (!body) {
          const detail = await fetchJson<{ post_stream: { posts: { username: string; cooked: string }[] } }>(
            `${MAGICIANS}/t/${topic.id}.json`,
          );
          const posts = detail.post_stream.posts.map((p) => ({ user: p.username, text: plain(p.cooked) }));
          const summary = posts.find((p) => p.user === 'system' && /^Meeting Summary/i.test(p.text));
          if (summary && !upcoming) {
            stage = 'summary';
            body = summary.text;
          } else {
            body = posts[0]?.text ?? '';
          }
          await sleep(300);
        }

        out.push({
          source: label,
          category: 'ethereum',
          url: stage === 'tldr' ? `https://forkcast.org/calls/${series}/${number}` : `${MAGICIANS}/t/${topic.slug}/${topic.id}`,
          // 资料从"议程"升级到"会议要点"时换一个键，让 LLM 重新总结
          key: `acd:${series}:${number}:${stage}`,
          title: topic.title,
          text: truncate(body, 6000),
          publishedAt: date,
          extra: { kind: 'call', series, number, upcoming, stage, forumUrl: `${MAGICIANS}/t/${topic.slug}/${topic.id}` },
        });
      }
    } catch (err) {
      errors.push(`${series}: ${(err as Error).message}`);
    }
  }
  if (!out.length) throw new Error(errors.join('; ') || '没有取到任何会议');
  if (errors.length) console.log(`  ! 部分会议系列失败: ${errors.join('; ')}`);
  return out.sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''));
}

/** 技术论坛本周热帖（Discourse 的 top 接口）。 */
function forumTop(source: string, base: string) {
  return async (): Promise<RawItem[]> => {
    const data = await fetchJson<{ topic_list: { topics: DiscourseTopic[] } }>(`${base}/top.json?period=weekly`);
    return data.topic_list.topics.slice(0, 12).map(
      (t): RawItem => ({
        source,
        category: 'ethereum',
        url: `${base}/t/${t.slug}/${t.id}`,
        title: t.title,
        publishedAt: t.created_at,
        metrics: { views: t.views, replies: Math.max(0, t.posts_count - 1), likes: t.like_count ?? 0 },
        extra: { kind: 'research' },
      }),
    );
  };
}
export const magiciansTop = forumTop('Ethereum Magicians', MAGICIANS);
export const ethresearchTop = forumTop('ethresear.ch', 'https://ethresear.ch');

/** 近 7 天有改动的 EIP（取 EIPs 仓库的提交，同一个 EIP 合并成一条）。 */
export async function eipUpdates(): Promise<RawItem[]> {
  const headers: Record<string, string> = { accept: 'application/vnd.github+json' };
  if (config.githubToken) headers.authorization = `Bearer ${config.githubToken}`;
  const commits = await fetchJson<any[]>(
    `https://api.github.com/repos/ethereum/EIPs/commits?per_page=60&since=${daysAgo(7).toISOString()}`,
    { headers },
  );
  const byEip = new Map<string, RawItem>();
  for (const c of commits) {
    const message = String(c.commit?.message ?? '').split('\n')[0]!;
    const num = message.match(/EIP-(\d+)/i)?.[1];
    if (!num) continue;
    const prev = byEip.get(num);
    if (prev) {
      prev.metrics = { updates: Number(prev.metrics?.updates ?? 1) + 1 };
      continue;
    }
    byEip.set(num, {
      source: /^add eip/i.test(message) ? '新 EIP' : 'EIP 更新',
      category: 'ethereum',
      url: `https://eips.ethereum.org/EIPS/eip-${num}`,
      key: `eip-commit:${c.sha}`,
      title: message.replace(/\s*\(#\d+\)$/, ''),
      publishedAt: c.commit?.author?.date,
      metrics: { updates: 1 },
      extra: { kind: 'eip', eip: Number(num), commitUrl: c.html_url },
    });
  }
  return [...byEip.values()];
}

/** 各客户端近 14 天的版本发布。 */
export async function clientReleases(): Promise<RawItem[]> {
  const since = daysAgo(14).toISOString();
  const out: RawItem[] = [];
  const errors: string[] = [];
  await Promise.all(
    ETH_CLIENTS.map(async ({ name, repo, layer }) => {
      try {
        for (const e of await fetchFeed(`https://github.com/${repo}/releases.atom`)) {
          if (!e.date || e.date < since) continue;
          out.push({
            source: name,
            category: 'ethereum',
            url: e.link,
            title: `${name} ${e.title}`,
            text: truncate(e.text, 600),
            publishedAt: e.date,
            extra: { kind: 'release', layer },
          });
        }
      } catch (err) {
        errors.push(`${name}: ${(err as Error).message}`);
      }
    }),
  );
  if (errors.length) console.log(`  ! 部分客户端发布页失败: ${errors.join('; ')}`);
  if (errors.length === ETH_CLIENTS.length) throw new Error(errors.join('; '));
  return out.sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''));
}

/** 生态新闻 feed。always=true 的来源本身就只讲以太坊，其余的交给 LLM 判断是否相关。 */
export function ecoFeed(feed: (typeof ETH_NEWS_FEEDS)[number]) {
  return async (): Promise<RawItem[]> => {
    const since = (feed.always ? daysAgo(14) : hoursAgo(36)).toISOString();
    return (await fetchFeed(feed.url))
      .filter((e) => e.date && e.date >= since)
      .slice(0, 40)
      .map(
        (e): RawItem => ({
          source: feed.source,
          category: 'ethereum',
          url: e.link,
          title: e.title,
          // 有的媒体在摘要末尾挂一句"去原站读全文"，去掉
          text: truncate(e.text.replace(/[.…\s]*Read the full story at [^.]+\.?\s*$/i, ''), 500),
          publishedAt: e.date,
          image: e.image,
          extra: { kind: 'news', always: feed.always },
        }),
      );
  };
}
