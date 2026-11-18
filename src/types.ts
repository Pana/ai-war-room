export type Category = 'news' | 'official' | 'product' | 'github' | 'podcast_show' | 'podcast' | 'ethereum';

/** 采集器的统一输出。 */
export interface RawItem {
  source: string;
  category: Category;
  url: string;
  title: string;
  /** 去重键，默认用 url。 */
  key?: string;
  /** 纯文本简介。 */
  text?: string;
  /** ISO 时间。 */
  publishedAt?: string;
  /** 配图地址（订阅源自带、原文封面图或平台缩略图）。 */
  image?: string;
  metrics?: Record<string, number | string | null | undefined>;
  extra?: Record<string, unknown>;
}

/** 入库后的条目：带上首次发现时间和 LLM 加工结果。 */
export interface Item extends RawItem {
  id: string;
  firstSeen: string;
  isNew: boolean;
  /** null = 尚未判断。 */
  ai: boolean | null;
  titleZh: string | null;
  summaryZh: string | null;
}

export interface SourceStatus {
  source: string;
  ok: boolean;
  count: number;
  ms: number;
  error?: string;
}

export interface TopNewsEntry {
  rank: number;
  title: string;
  summary: string;
  image?: string;
  links: { source: string; title: string; url: string; points?: number }[];
}

export interface Report {
  date: string;
  generatedAt: string;
  llm: { configured: boolean; model: string; errors: string[] };
  sources: SourceStatus[];
  topNews: TopNewsEntry[];
  news: Item[];
  official: Item[];
  products: { productHunt: Item[]; showHn: Item[]; hfSpaces: Item[]; hfModels: Item[] };
  github: { daily: Item[]; weekly: Item[]; fresh: Item[] };
  podcasts: { episodes: Item[]; shows: Item[] };
  /** 以太坊：核心开发者会议、研究与提案、客户端发布、生态新闻。旧报告里没有这一项。 */
  ethereum?: {
    top: TopNewsEntry[];
    calls: Item[];
    research: Item[];
    eips: Item[];
    releases: Item[];
    news: Item[];
  };
}
