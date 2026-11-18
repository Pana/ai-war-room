import type { SourceStatus } from '../types.ts';

/** 本次运行里每个数据源的结果，最后写进报告。 */
export const statuses: SourceStatus[] = [];

/** 跑一个数据源：失败不影响其他源，只记录下来。 */
export async function runSource<T>(source: string, fn: () => Promise<T[]>): Promise<T[]> {
  const t0 = Date.now();
  try {
    const out = await fn();
    statuses.push({ source, ok: true, count: out.length, ms: Date.now() - t0 });
    console.log(`  ✓ ${source}: ${out.length} 条 (${Date.now() - t0}ms)`);
    return out;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    statuses.push({ source, ok: false, count: 0, ms: Date.now() - t0, error });
    console.log(`  ✗ ${source}: ${error}`);
    return [];
  }
}
