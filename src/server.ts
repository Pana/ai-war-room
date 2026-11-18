import { readFileSync } from 'node:fs';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { config } from './config.ts';
import { loadReport, reportDates } from './db.ts';

const app = new Hono();
const file = (name: string) => readFileSync(new URL(`../public/${name}`, import.meta.url), 'utf8');

// 每次读盘，改页面不用重启。/ 是三栏阅读器，/daily 是日报版面，两者读同一份报告。
app.get('/', (c) => c.html(file('index.html')));
app.get('/daily', (c) => c.html(file('daily.html')));
app.get('/logo.svg', (c) => c.body(file('logo.svg'), 200, { 'content-type': 'image/svg+xml; charset=utf-8' }));

app.get('/api/dates', (c) => c.json(reportDates()));

app.get('/api/report/:date', (c) => {
  const report = loadReport(c.req.param('date'));
  return report ? c.json(report) : c.json({ error: '这一天没有报告' }, 404);
});

serve({ fetch: app.fetch, port: config.port, hostname: '127.0.0.1' }, (info) => {
  console.log(`AI 动态：http://localhost:${info.port}`);
});
