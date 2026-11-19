// Tests for Flow3 kanban grouping (P2-11).
// Run: node --test src/flows/flow-3-panel/kanban.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kanbanColumns, KANBAN_ORDER } from './kanban.ts';
import type { Session } from '../shared/types';

const s = (id: string, status: Session['status']): Session => ({
  id,
  projectId: 'live',
  agentId: 'claude',
  title: id,
  status,
  messages: [],
  artifactIds: [],
  updatedAt: '2026-11-16T00:00:00.000Z',
});

test('kanban: fixed column order (active/waiting/done/stuck/archived) even when empty', () => {
  const cols = kanbanColumns([]);
  assert.deepEqual(cols.map((c) => c.status), KANBAN_ORDER);
  assert.deepEqual(cols.map((c) => c.status), ['active', 'waiting', 'done', 'stuck', 'archived']);
  assert.ok(cols.every((c) => c.sessions.length === 0), '空列保留，不因无会话而消失');
});

test('kanban: sessions grouped by status, within-column order preserved', () => {
  const a = s('a', 'active');
  const w1 = s('w1', 'waiting');
  const d = s('d', 'done');
  const w2 = s('w2', 'waiting');
  const cols = kanbanColumns([a, w1, d, w2]);
  const byStatus = Object.fromEntries(cols.map((c) => [c.status, c.sessions.map((x) => x.id)]));
  assert.deepEqual(byStatus.active, ['a']);
  assert.deepEqual(byStatus.waiting, ['w1', 'w2'], '列内保持输入顺序，不二次排序');
  assert.deepEqual(byStatus.done, ['d']);
  assert.deepEqual(byStatus.stuck, []);
  assert.deepEqual(byStatus.archived, []);
});

test('kanban: project scope never mixes sessions from another project', () => {
  const owned = { ...s('owned', 'active'), projectId: 'p1' };
  const other = { ...s('other', 'active'), projectId: 'p2' };
  const cols = kanbanColumns([owned, other], 'p1');
  assert.deepEqual(cols.find((col) => col.status === 'active')?.sessions.map((item) => item.id), ['owned']);
  const all = kanbanColumns([owned, other], null);
  assert.deepEqual(all.find((col) => col.status === 'active')?.sessions.map((item) => item.id), ['owned', 'other']);
});

test('kanban: no column ever duplicates a session (statuses are mutually exclusive)', () => {
  const sessions = ['active', 'waiting', 'done', 'stuck', 'archived'].map((st, i) => s(`s${i}`, st as Session['status']));
  const all = kanbanColumns(sessions).flatMap((c) => c.sessions);
  assert.equal(all.length, sessions.length);
  assert.equal(new Set(all.map((x) => x.id)).size, sessions.length);
});
