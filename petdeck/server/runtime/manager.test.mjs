// Manager client and prompt helpers: config redaction, OpenAI-compatible requests,
// loose proposal extraction and deterministic fallbacks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MANAGER_DEFAULTS,
  PROPOSE_TASKS_TOOL,
  buildLocalReport,
  createManagerClient,
  extractLooseProposal,
  stripToolCallEcho,
  normalizeManagerPatch,
  publicManagerConfig,
  resolveManagerConfig,
} from './manager.mjs';

test('manager config: environment key is used but never exposed publicly', () => {
  const config = resolveManagerConfig(
    { provider: 'openai', model: 'gpt-test', temperature: 9, timeoutMs: 1 },
    { OPENAI_API_KEY: 'sk-test' },
  );
  assert.equal(config.ready, true);
  assert.equal(config.apiKeySource, 'environment');
  assert.equal(config.temperature, 2);
  assert.equal(config.timeoutMs, 5000);
  const publicConfig = publicManagerConfig(config);
  assert.equal(publicConfig.apiKeySet, true);
  assert.equal('apiKey' in publicConfig, false);
  assert.equal(publicConfig.model, 'gpt-test');
});

test('manager config: custom endpoints never inherit the OpenAI environment key', () => {
  const custom = resolveManagerConfig(
    { provider: 'custom', baseUrl: 'https://manager.example/v1', model: 'glm-test' },
    { OPENAI_API_KEY: 'sk-openai-must-stay-local' },
  );
  assert.equal(custom.apiKey, '');
  assert.equal(custom.apiKeySource, 'none');

  const explicit = resolveManagerConfig(
    { provider: 'custom', baseUrl: 'https://manager.example/v1', model: 'glm-test' },
    { OPENAI_API_KEY: 'sk-openai-must-stay-local', PETDECK_MANAGER_API_KEY: 'custom-key' },
  );
  assert.equal(explicit.apiKey, 'custom-key');
  assert.equal(explicit.apiKeySource, 'environment');
});

test('manager config: key-requiring provider is not ready without a key', () => {
  const config = resolveManagerConfig({ provider: 'openai', model: 'gpt-test' }, {});
  assert.equal(config.ready, false);
  const local = resolveManagerConfig({ provider: 'ollama', model: 'llama3' }, {});
  assert.equal(local.ready, true);
});

test('manager patch: provider switch adopts its preset and validates URLs', () => {
  const switched = normalizeManagerPatch({ provider: 'ollama' }, { ...MANAGER_DEFAULTS });
  assert.equal(switched.baseUrl, 'http://127.0.0.1:11434/v1');
  assert.throws(() => normalizeManagerPatch({ baseUrl: 'file:///tmp/x' }, switched), (error) => error.code === 'INVALID_INPUT');
  assert.throws(() => normalizeManagerPatch({ temperature: -0.1 }, switched), (error) => error.code === 'INVALID_INPUT');
});

test('manager client: sends auth, tools and maps structured tool calls', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        model: 'gpt-test',
        choices: [{ message: { content: '需要拆成两个任务', tool_calls: [{ id: 'call-1', function: { name: 'propose_tasks', arguments: '{"tasks":[]}' } }] } }],
        usage: { total_tokens: 12 },
      }),
    };
  };
  const client = createManagerClient({
    getConfig: () => ({ provider: 'openai', baseUrl: 'https://manager.example/v1', model: 'gpt-test', apiKey: 'sk-secret', temperature: 0.3, timeoutMs: 1000, ready: true }),
    fetchImpl,
  });
  const result = await client.chat({ messages: [{ role: 'user', content: '做两个任务' }], tools: [PROPOSE_TASKS_TOOL] });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://manager.example/v1/chat/completions');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer sk-secret');
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.model, 'gpt-test');
  assert.equal(body.tool_choice, 'auto');
  assert.equal(result.content, '需要拆成两个任务');
  assert.equal(result.toolCalls[0].name, 'propose_tasks');
  assert.equal(result.model, 'gpt-test');
});

test('manager client: strips a raw tool-call chunk echoed into content', async () => {
  const polluted = '我来拆解。{"index":0,"finish_reason":"tool_calls","delta":{"role":"assistant","tool_calls":[{"function":{"name":"propose_tasks"}}]}}';
  assert.equal(stripToolCallEcho(polluted, [{ name: 'propose_tasks' }]), '我来拆解。');
  assert.equal(stripToolCallEcho('我来拆解。', []), '我来拆解。');
  assert.equal(stripToolCallEcho('正常提到 {"index":0,"finish_reason":"stop"}', [{ name: 'propose_tasks' }]), '正常提到 {"index":0,"finish_reason":"stop"}');

  const client = createManagerClient({
    getConfig: () => ({ provider: 'custom', baseUrl: 'https://manager.example/v1', model: 'glm-test', apiKey: 'sk-test', temperature: 0.3, timeoutMs: 1000, ready: true }),
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        model: 'glm-test',
        choices: [{ message: { content: polluted, tool_calls: [{ id: 'call-1', function: { name: 'propose_tasks', arguments: '{"tasks":[]}' } }] } }],
      }),
    }),
  });
  const result = await client.chat({ messages: [{ role: 'user', content: '拆任务' }], tools: [PROPOSE_TASKS_TOOL] });
  assert.equal(result.content, '我来拆解。');
  assert.equal(result.toolCalls[0].name, 'propose_tasks');
});

test('manager client: missing key and HTTP errors are explicit', async () => {
  const noKey = createManagerClient({
    getConfig: () => ({ provider: 'openai', baseUrl: 'https://manager.example/v1', model: 'gpt-test', apiKey: '', temperature: 0.3, timeoutMs: 1000, ready: true }),
    fetchImpl: async () => { throw new Error('should not fetch'); },
  });
  await assert.rejects(() => noKey.chat({ messages: [] }), (error) => error.code === 'MANAGER_KEY_MISSING');

  const bad = createManagerClient({
    getConfig: () => ({ provider: 'ollama', baseUrl: 'http://127.0.0.1:11434/v1', model: 'llama3', apiKey: '', temperature: 0.3, timeoutMs: 1000, ready: true }),
    fetchImpl: async () => ({ ok: false, status: 500, text: async () => JSON.stringify({ error: { message: 'boom' } }) }),
  });
  await assert.rejects(() => bad.chat({ messages: [] }), (error) => error.code === 'MANAGER_HTTP_ERROR' && /boom/.test(error.message));
});

test('manager helpers: loose proposals and local report fallback', () => {
  const proposal = extractLooseProposal('好的：\n```json\n{"summary":"拆分","tasks":[{"title":"A","prompt":"do A"}]}\n```');
  assert.equal(proposal.tasks[0].title, 'A');
  const report = buildLocalReport({
    date: '2026-11-21',
    projectName: 'Demo',
    stats: { total: 2, completed: 1, merged: 0, failed: 1, decisions: 0, proposals: 0 },
    tasks: [{ title: 'A', status: 'completed' }, { title: 'B', status: 'failed', last_feedback: 'fix it' }],
    decisions: [],
    proposals: [],
  });
  assert.match(report, /## 今日产出/);
  assert.match(report, /## 明天建议/);
  assert.match(report, /B/);
});
