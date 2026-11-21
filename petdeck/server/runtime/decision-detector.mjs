// Decision-card detection: turn a final agent reply into a question + options.
// Deliberately conservative — a false card interrupts the user, a missed one is
// recoverable from the transcript. The runtime never selects an option itself.

const OPTION_LINE = /^\s*(?:(?:[-*\u2022])|(?:\d{1,2}[.)\u3001])|(?:[A-Ha-h][.)\u3001]))\s+(.{1,160})$/;
const QUESTION_HINT = /(?:[?\uFF1F]|\u8BF7\u9009\u62E9|\u8BF7\u786E\u8BA4|\u9700\u8981\u4F60|\u7B49\u5F85\u4F60|\byour call\b|\bneed you\b|\u662F\u5426|\u8981\u4E0D\u8981|\u54EA\u4E2A|\u54EA\u4E00\u4E2A|\b(?:choose|confirm|which|select|proceed|option|shall i)\b)/i;
const STRONG_HINT = /(?:[?\uFF1F]|\u8BF7\u9009\u62E9|\u8BF7\u786E\u8BA4|\u9700\u8981\u4F60|\u7B49\u5F85\u4F60|\byour call\b|\bneed you\b|\b(?:choose|confirm|which option|select one|shall i proceed)\b)/i;

function cleanFragment(line) {
  return String(line)
    .replace(/\u001b\[[0-9;]*m/g, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanLine(line) {
  return cleanFragment(String(line).replace(/^\s*(?:[-*\u2022]|\d{1,2}[.)\u3001]|[A-Ha-h][.)\u3001])\s*/, ''));
}

function stripTrailing(text) {
  return text.replace(/[\s\u3002\uFF0C,;\uFF1B:\uFF1A]+$/, '').trim();
}

/** @returns {{question:string, options:{label:string,description?:string}[], allowFreeform:boolean}|null} */
export function detectDecision(text) {
  const raw = typeof text === 'string' ? text.replace(/\r\n/g, '\n').trim() : '';
  if (raw.length < 12 || raw.length > 20_000) return null;
  const lines = raw.split('\n');
  // Only inspect the tail: earlier prose may contain example questions without
  // being the agent's actual ask.
  const start = Math.max(0, lines.length - 60);
  const tail = lines.slice(start);

  const optionIndexes = [];
  const options = [];
  for (let i = 0; i < tail.length; i += 1) {
    const line = tail[i];
    if (!line.trim()) continue;
    const match = OPTION_LINE.exec(line);
    if (!match) continue;
    const label = stripTrailing(cleanFragment(match[1]));
    if (!label || label.length > 100) continue;
    if (/^(?:https?:|\/|[A-Za-z]:\\|\$ )/.test(label)) continue;
    optionIndexes.push(i);
    options.push({ label });
    if (options.length > 8) break;
  }
  if (options.length < 2 || options.length > 8) return null;

  // Options must form a compact block (allow a one-line heading in between).
  const first = optionIndexes[0];
  const last = optionIndexes[optionIndexes.length - 1];
  if (last - first > options.length + 4) return null;

  const isOption = new Set(optionIndexes);
  const candidates = [];
  for (let i = 0; i < tail.length; i += 1) {
    if (isOption.has(i)) continue;
    const line = stripTrailing(cleanLine(tail[i]));
    if (!line || line.length < 2 || line.length > 500) continue;
    if (/^[{}\[\]]$/.test(line)) continue;
    if (QUESTION_HINT.test(line)) candidates.push({ i, line });
  }
  if (!candidates.length) return null;
  // Prefer the line closest to the option block (before or after), and require a
  // strong hint: ? / 请选择 / 请确认 / choose / confirm.
  const anchor = first;
  candidates.sort((a, b) => Math.abs(a.i - anchor) - Math.abs(b.i - anchor));
  const question = candidates.find((c) => STRONG_HINT.test(c.line))?.line ?? null;
  if (!question) return null;

  const unique = [];
  for (const opt of options) {
    if (!unique.some((u) => u.label === opt.label)) unique.push(opt);
  }
  if (unique.length < 2) return null;

  return {
    question: question.slice(0, 500),
    options: unique.slice(0, 6),
    allowFreeform: true,
  };
}

export default detectDecision;