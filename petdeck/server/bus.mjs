// Unified AgentEvent bus (server side): normalize + replay + fan-out to SSE.
import { randomUUID } from 'node:crypto';

const PET_TYPE = {
  task_complete: 'done',
  turn_aborted: 'stuck',
  decision: 'decision',
  'relay-ready': 'relay-ready',
};

export function toPetEventType(t) {
  return PET_TYPE[t] ?? 'done';
}

export function createBus(cap = 50) {
  const subs = new Set();
  const replay = [];
  return {
    emit(raw) {
      const e = { id: randomUUID(), ts: Date.now(), ...raw };
      replay.push(e);
      if (replay.length > cap) replay.shift();
      for (const fn of subs) fn(e);
      return e;
    },
    subscribe(fn) {
      for (const e of [...replay]) fn(e);
      subs.add(fn);
      return () => subs.delete(fn);
    },
    snapshot() {
      return [...replay];
    },
  };
}