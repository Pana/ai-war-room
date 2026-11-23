import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { config, hoursAgo } from './config.ts';
import type { Item, RawItem, Report } from './types.ts';

mkdirSync(dirname(config.dbPath), { recursive: true });
export const db = new DatabaseSync(config.dbPath);

db.exec(`
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  source TEXT NOT NULL,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  text TEXT,
  published_at TEXT,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  ai INTEGER,
  title_zh TEXT,
  summary_zh TEXT
);
CREATE TABLE IF NOT EXISTS github_snapshots (
  repo TEXT NOT NULL,
  date TEXT NOT NULL,
  stars INTEGER NOT NULL,
  PRIMARY KEY (repo, date)
);
CREATE TABLE IF NOT EXISTS reports (
  date TEXT PRIMARY KEY,
  generated_at TEXT NOT NULL,
  payload TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`);

const itemId = (r: RawItem) =>
  `${r.category}:${createHash('sha1')
    .update(r.key ?? r.url)
    .digest('hex')
    .slice(0, 16)}`;

const selItem = db.prepare('SELECT first_seen, ai, title_zh, summary_zh FROM items WHERE id = ?');
const insItem = db.prepare(
  `INSERT INTO items (id, category, source, url, title, text, published_at, first_seen, last_seen)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);
const updItem = db.prepare('UPDATE items SET last_seen = ?, title = ?, text = ?, url = ? WHERE id = ?');

/** 入库（已存在则只刷新），并带回首次发现时间和已有的 LLM 加工结果。 */
export function upsertItems(raws: RawItem[]): Item[] {
  const now = new Date().toISOString();
  const newSince = hoursAgo(24).toISOString();
  return raws.map((r) => {
    const id = itemId(r);
    const row = selItem.get(id) as
      | { first_seen: string; ai: number | null; title_zh: string | null; summary_zh: string | null }
      | undefined;
    if (!row) {
      insItem.run(id, r.category, r.source, r.url, r.title, r.text ?? null, r.publishedAt ?? null, now, now);
    } else {
      updItem.run(now, r.title, r.text ?? null, r.url, id);
    }
    const firstSeen = row?.first_seen ?? now;
    return {
      ...r,
      id,
      firstSeen,
      isNew: firstSeen >= newSince,
      ai: row?.ai == null ? null : row.ai === 1,
      titleZh: row?.title_zh ?? null,
      summaryZh: row?.summary_zh ?? null,
    };
  });
}

const updEnrich = db.prepare('UPDATE items SET ai = ?, title_zh = ?, summary_zh = ? WHERE id = ?');
export function saveEnrichment(id: string, ai: boolean, titleZh: string | null, summaryZh: string | null) {
  updEnrich.run(ai ? 1 : 0, titleZh, summaryZh, id);
}

// ---- GitHub star 快照 ----
const insSnap = db.prepare('INSERT OR REPLACE INTO github_snapshots (repo, date, stars) VALUES (?, ?, ?)');
const selSnap = db.prepare(
  'SELECT date, stars FROM github_snapshots WHERE repo = ? AND date < ? AND date >= ? ORDER BY date ASC LIMIT 1',
);
export function saveSnapshot(repo: string, date: string, stars: number) {
  insSnap.run(repo, date, stars);
}
/** 取 date 之前、最早不早于 since 的一条快照，用来算自有的 star 增量。 */
export function earlierSnapshot(repo: string, date: string, since: string) {
  return selSnap.get(repo, date, since) as { date: string; stars: number } | undefined;
}

// ---- 报告 ----
export function saveReport(report: Report) {
  db.prepare('INSERT OR REPLACE INTO reports (date, generated_at, payload) VALUES (?, ?, ?)').run(
    report.date,
    report.generatedAt,
    JSON.stringify(report),
  );
}
export function loadReport(date: string): Report | undefined {
  const row = db.prepare('SELECT payload FROM reports WHERE date = ?').get(date) as { payload: string } | undefined;
  return row ? (JSON.parse(row.payload) as Report) : undefined;
}
/**
 * [since, before) 这几天的报告里已经展示过的新闻链接（要闻、新闻列表、以太坊要闻和新闻），
 * 用来让当天的报告不再重复前几天的内容。不含 before 当天，所以同一天重跑不受影响。
 */
export function shownNewsUrls(before: string, since: string): Set<string> {
  const rows = db
    .prepare('SELECT payload FROM reports WHERE date < ? AND date >= ?')
    .all(before, since) as { payload: string }[];
  const urls = new Set<string>();
  for (const { payload } of rows) {
    const r = JSON.parse(payload) as Report;
    for (const e of [...r.topNews, ...(r.ethereum?.top ?? [])]) for (const l of e.links) urls.add(l.url);
    for (const it of [...r.news, ...(r.ethereum?.news ?? [])]) urls.add(it.url);
  }
  return urls;
}
export function reportDates(): string[] {
  return (db.prepare('SELECT date FROM reports ORDER BY date DESC').all() as { date: string }[]).map((r) => r.date);
}

// ---- 小缓存（YouTube 频道 ID、播客的 Apple ID 等）----
export function kvGet<T>(key: string): T | undefined {
  const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as { value: string } | undefined;
  return row ? (JSON.parse(row.value) as T) : undefined;
}
export function kvSet(key: string, value: unknown) {
  db.prepare('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)').run(key, JSON.stringify(value));
}
