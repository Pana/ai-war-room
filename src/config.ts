const env = process.env;

export const config = {
  dbPath: env.DB_PATH || 'data/ai.db',
  port: Number(env.PORT || 8787),
  tz: env.REPORT_TZ || 'Asia/Shanghai',
  githubToken: env.GITHUB_TOKEN || undefined,
  llm: {
    baseUrl: (env.LLM_BASE_URL || '').replace(/\/+$/, ''),
    apiKey: env.LLM_API_KEY || '',
    model: env.LLM_MODEL || '',
    format: env.LLM_API_FORMAT === 'anthropic' ? ('anthropic' as const) : ('openai' as const),
  },
};

/** 报告日期：按配置时区取当天，格式 YYYY-MM-DD。 */
export function reportDate(d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: config.tz }).format(d);
}

export const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000);
export const daysAgo = (d: number) => hoursAgo(d * 24);
