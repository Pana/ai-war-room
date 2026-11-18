import * as cheerio from 'cheerio';
import { fetchJson, fetchText, sleep } from '../lib/http.ts';
import { num, truncate } from '../lib/text.ts';
import { config, daysAgo } from '../config.ts';
import { GITHUB_TOPICS } from '../sources.ts';
import type { RawItem } from '../types.ts';

/** GitHub Trending 页面：自带"本周期新增 star"。 */
function trending(since: 'daily' | 'weekly') {
  return async (): Promise<RawItem[]> => {
    const html = await fetchText(`https://github.com/trending?since=${since}`, { timeoutMs: 30_000 });
    const $ = cheerio.load(html);
    const out: RawItem[] = [];
    $('article.Box-row').each((_, el) => {
      const row = $(el);
      const repo = (row.find('h2 a').first().attr('href') ?? '').replace(/^\//, '').trim();
      if (!/^[^/]+\/[^/]+$/.test(repo)) return;
      const stars = num(row.find(`a[href="/${repo}/stargazers"]`).text());
      const gained = num(row.find('span.float-sm-right').text());
      out.push({
        source: since === 'daily' ? 'GitHub Trending 日榜' : 'GitHub Trending 周榜',
        category: 'github',
        url: `https://github.com/${repo}`,
        title: repo,
        text: truncate(row.find('p').first().text().trim(), 400),
        image: `https://opengraph.githubassets.com/1/${repo}`,
        metrics: {
          stars,
          forks: num(row.find(`a[href="/${repo}/forks"]`).text()),
          gained,
          // 相对增速：新增 ÷ 周期开始时的存量，用来发现小而新的项目
          growthPct: stars > gained ? Math.round((gained / (stars - gained)) * 1000) / 10 : null,
          language: row.find('[itemprop="programmingLanguage"]').text().trim() || null,
        },
      });
    });
    if (!out.length) throw new Error('GitHub Trending 页面没有解析出仓库，页面结构可能变了');
    return out;
  };
}

export const trendingDaily = trending('daily');
export const trendingWeekly = trending('weekly');

interface GhRepo {
  full_name: string;
  html_url: string;
  description: string | null;
  stargazers_count: number;
  forks_count: number;
  language: string | null;
  created_at: string;
  topics?: string[];
}

/** 近 30 天新建、按 star 排序的 AI 相关仓库（按 topic 搜索后合并去重）。 */
export async function freshRepos(): Promise<RawItem[]> {
  const since = daysAgo(30).toISOString().slice(0, 10);
  const headers: Record<string, string> = {
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
  };
  if (config.githubToken) headers.authorization = `Bearer ${config.githubToken}`;

  const byRepo = new Map<string, GhRepo>();
  const errors: string[] = [];
  for (const topic of GITHUB_TOPICS) {
    const q = encodeURIComponent(`topic:${topic} created:>${since} stars:>100`);
    try {
      const data = await fetchJson<{ items: GhRepo[] }>(
        `https://api.github.com/search/repositories?q=${q}&sort=stars&order=desc&per_page=30`,
        { headers },
      );
      for (const r of data.items) byRepo.set(r.full_name, r);
    } catch (err) {
      errors.push(`${topic}: ${(err as Error).message}`);
    }
    // 匿名搜索接口每分钟 10 次，留出间隔
    await sleep(config.githubToken ? 300 : 1500);
  }
  if (!byRepo.size) throw new Error(`GitHub 搜索全部失败：${errors.join('; ')}`);

  return [...byRepo.values()]
    .sort((a, b) => b.stargazers_count - a.stargazers_count)
    .slice(0, 40)
    .map((r): RawItem => {
      const ageDays = Math.max(1, (Date.now() - new Date(r.created_at).getTime()) / 86400_000);
      return {
        source: 'GitHub 新项目',
        category: 'github',
        url: r.html_url,
        title: r.full_name,
        text: truncate(r.description ?? '', 400),
        publishedAt: r.created_at,
        image: `https://opengraph.githubassets.com/1/${r.full_name}`,
        metrics: {
          stars: r.stargazers_count,
          forks: r.forks_count,
          ageDays: Math.round(ageDays),
          starsPerDay: Math.round(r.stargazers_count / ageDays),
          language: r.language,
        },
        extra: { topics: (r.topics ?? []).slice(0, 8) },
      };
    });
}
