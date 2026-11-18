import * as cheerio from 'cheerio';

/** HTML（或被转义过一次的 HTML）转纯文本。 */
export function plain(s: unknown): string {
  if (typeof s !== 'string' || !s) return '';
  let t = cheerio.load(`<body>${s}</body>`).text();
  if (/<[a-z][\s\S]*>/i.test(t)) t = cheerio.load(`<body>${t}</body>`).text();
  return t.replace(/\s+/g, ' ').trim();
}

export function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

export function decodeXml(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

export function toIso(v: unknown): string | undefined {
  if (typeof v !== 'string' && typeof v !== 'number') return undefined;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? new Date(t).toISOString() : undefined;
}

export function num(s: string | undefined | null): number {
  const n = Number(String(s ?? '').replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/** 播客节目名归一化：去掉副标题和标点，用来跨平台对齐同一档节目。 */
export function normName(name: string): string {
  return name
    .toLowerCase()
    .split(/\s[-–—]\s|[:|(]/)[0]!
    .replace(/[^a-z0-9]+/g, '');
}

const AI_RE =
  /\b(ai|a\.i\.|agi|llms?|gpt[\w.-]*|openai|anthropic|claude|gemini|deepmind|agents?|agentic|machine learning|deep learning|neural|transformers?|diffusion|copilot|chatbots?|chatgpt|nvidia|mistral|llama|deepseek|hugging ?face|rag|mcp|genai|generative|inference|fine-?tun\w*|embeddings?|xai|grok|sora|midjourney|perplexity|cursor)\b/i;

/** 没有 LLM 时的兜底：关键词判断是否与 AI 相关。 */
export const looksAi = (s: string) => AI_RE.test(s);

const ETH_RE =
  /\b(ethereum|ether|eth|vitalik|l2s?|layer[ -]?2|rollups?|arbitrum|optimism|base|zksync|starknet|linea|scroll|staking|restaking|eigen\w*|lido|defi|uniswap|aave|maker|sky|eip-?\d+|erc-?\d+|evm|solidity|blobs?|pectra|fusaka|glamsterdam|hegot[aá])\b/i;

/** 没有 LLM 时的兜底：关键词判断是否与以太坊生态相关。 */
export const looksEth = (s: string) => ETH_RE.test(s);

/** 标题相似度（词集合的重合比例），用于把播客单集对上 YouTube 视频。 */
export function titleOverlap(a: string, b: string): number {
  const tok = (s: string) => new Set(s.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []);
  const A = tok(a);
  const B = tok(b);
  if (!A.size || !B.size) return 0;
  let hit = 0;
  for (const w of A) if (B.has(w)) hit++;
  return hit / Math.min(A.size, B.size);
}
