/**
 * 把报告导出成静态网站（site/），用于 GitHub Pages 等静态托管。
 *   site/index.html、daily.html、logo.svg   页面（原样复制 public/）
 *   site/api/dates.json                      有报告的日期，新的在前
 *   site/api/report/<日期>.json              每天的报告
 *   site/api/search.json                     这些天报告的搜索索引
 * 页面里的地址都是相对路径，所以放在子路径下（如 xxx.github.io/仓库名/）也能用。
 */
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { config } from './config.ts';
import { db, loadReport, reportDates } from './db.ts';
import { buildSearchIndex } from './search.ts';

const KEEP_DAYS = config.exportDays;
const out = new URL('../site/', import.meta.url);

rmSync(out, { recursive: true, force: true });
mkdirSync(new URL('api/report/', out), { recursive: true });
cpSync(new URL('../public/', import.meta.url), out, { recursive: true });
writeFileSync(new URL('.nojekyll', out), ''); // 让 GitHub Pages 原样发布，不经过 Jekyll

const dates = reportDates().slice(0, KEEP_DAYS);
for (const date of dates) {
  writeFileSync(new URL(`api/report/${date}.json`, out), JSON.stringify(loadReport(date)));
}
writeFileSync(new URL('api/dates.json', out), JSON.stringify(dates));
const index = buildSearchIndex(KEEP_DAYS);
writeFileSync(new URL('api/search.json', out), JSON.stringify(index));

// 把 WAL 日志合并回主文件，这样单独保存 ai.db 一个文件就是完整的数据库
db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
db.close();

console.log(`已导出 ${dates.length} 天的报告、${index.length} 条搜索索引到 site/（数据库 ${config.dbPath} 已合并 WAL）`);
