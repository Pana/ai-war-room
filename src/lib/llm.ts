import { config } from '../config.ts';
import { sleep } from './http.ts';

export const llmConfigured = () => Boolean(config.llm.baseUrl && config.llm.apiKey && config.llm.model);

/** 本次运行里 LLM 出过的错，写进报告方便在网页上看到。 */
export const llmErrors: string[] = [];

async function chat(system: string, user: string): Promise<string> {
  const { baseUrl, apiKey, model, format } = config.llm;
  const isAnthropic = format === 'anthropic';
  const url = `${baseUrl}/${isAnthropic ? 'messages' : 'chat/completions'}`;
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    authorization: `Bearer ${apiKey}`,
  };
  if (isAnthropic) {
    headers['x-api-key'] = apiKey;
    headers['anthropic-version'] = '2023-06-01';
  }
  const body = isAnthropic
    ? { model, max_tokens: 8000, system, messages: [{ role: 'user', content: user }] }
    : {
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      };

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180_000),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`LLM HTTP ${res.status}: ${raw.slice(0, 300)}`);
  const data = JSON.parse(raw);
  const text = isAnthropic
    ? (data.content ?? [])
        .filter((b: any) => b.type === 'text')
        .map((b: any) => b.text)
        .join('')
    : data.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || !text.trim()) throw new Error(`LLM 返回为空: ${raw.slice(0, 300)}`);
  return text;
}

/** 从模型输出里取出 JSON（容忍代码块包裹和前后多余文字）。 */
function extractJson(text: string): unknown {
  const t = text.replace(/```(?:json)?/gi, '').trim();
  const starts = [t.indexOf('['), t.indexOf('{')].filter((i) => i >= 0);
  if (!starts.length) throw new Error('LLM 输出里没有 JSON');
  const start = Math.min(...starts);
  const end = Math.max(t.lastIndexOf(']'), t.lastIndexOf('}'));
  return JSON.parse(t.slice(start, end + 1));
}

/** 调用 LLM 并解析 JSON，失败重试一次。 */
export async function chatJson<T>(system: string, user: string): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return extractJson(await chat(system, user)) as T;
    } catch (err) {
      lastErr = err;
      await sleep(2000);
    }
  }
  const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
  llmErrors.push(msg);
  throw new Error(msg);
}
