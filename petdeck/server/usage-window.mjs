// Claude 订阅计划的 5 小时用量窗口（对标 petdash 的 reset countdown）。
// 口径：窗口从上一窗口结束后的第一条消息起算，resetAt = 窗口起点 + 5h。
// 数据只来自本地 jsonl 的时间戳——这是推算值，UI 必须标注「估」；
// 订阅配额百分比无法从 jsonl 得知，不做猜测（诚实约定）。
export const WINDOW_MS = 5 * 60 * 60 * 1000;

const zeroTokens = () => ({ input: 0, output: 0, cacheRead: 0 });

/** 纯函数：带时间戳的 usage marks -> 当前 5h 窗口状态。
 *  entries: [{ ts: ISO 字符串, tokens: {input,output,cacheRead} }]
 *  now: number（epoch ms，可注入以便测试）
 *  返回 { active, blockStart, resetAt, minutesToReset, windowTokens }，
 *  blockStart/resetAt 为 ISO 字符串或 null；窗口已结束时 active=false、minutesToReset=0。 */
export function computeUsageWindow(entries, now) {
  const nowMs = typeof now === 'number' ? now : Date.parse(now); // ISO 字符串也可注入，便于测试
  const marks = entries
    .filter((e) => typeof e?.ts === 'string' && !Number.isNaN(Date.parse(e.ts)))
    .map((e) => ({ t: Date.parse(e.ts), tokens: e.tokens ?? zeroTokens() }))
    .sort((a, b) => a.t - b.t);
  const empty = { active: false, blockStart: null, resetAt: null, minutesToReset: 0, windowTokens: zeroTokens() };
  if (!marks.length) return empty;

  // 分块：与上一条间隔 >= WINDOW_MS（窗口到期）即开新块；等于 5h 也算新块。
  let blockStart = marks[0].t;
  const blocks = [{ start: blockStart, marks: [marks[0]] }];
  for (let i = 1; i < marks.length; i++) {
    if (marks[i].t - blockStart >= WINDOW_MS) {
      blockStart = marks[i].t;
      blocks.push({ start: blockStart, marks: [] });
    }
    blocks[blocks.length - 1].marks.push(marks[i]);
  }

  const cur = blocks[blocks.length - 1];
  const resetAt = cur.start + WINDOW_MS;
  if (resetAt <= nowMs) return empty; // 最后一次活动距今超过 5h：窗口已过期，下次活动开新窗

  const windowTokens = cur.marks.reduce(
    (acc, m) => ({ input: acc.input + (m.tokens.input ?? 0), output: acc.output + (m.tokens.output ?? 0), cacheRead: acc.cacheRead + (m.tokens.cacheRead ?? 0) }),
    zeroTokens(),
  );
  return {
    active: true,
    blockStart: new Date(cur.start).toISOString(),
    resetAt: new Date(resetAt).toISOString(),
    minutesToReset: Math.ceil((resetAt - nowMs) / 60000),
    windowTokens,
  };
}
