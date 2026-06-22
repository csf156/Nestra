import assert from 'node:assert';
import { test } from 'node:test';
import { lwwWinner } from '../js/sync-lww.js';

test('local gana si su updated_at es más nuevo que el del servidor', () => {
  const local = { id: 'a', updated_at: '2026-06-21T10:00:01Z' };
  const server = { id: 'a', updated_at: '2026-06-21T10:00:00Z' };
  assert.strictEqual(lwwWinner(local, server), 'local');
});
test('server gana si su updated_at es más nuevo', () => {
  const local = { id: 'a', updated_at: '2026-06-21T10:00:00Z' };
  const server = { id: 'a', updated_at: '2026-06-21T10:00:05Z' };
  assert.strictEqual(lwwWinner(local, server), 'server');
});
test('si no hay fila en server, gana local', () => {
  const local = { id: 'a', updated_at: '2026-06-21T10:00:00Z' };
  assert.strictEqual(lwwWinner(local, null), 'local');
});
test('empate exacto → server (idempotente, no reescribe)', () => {
  const local = { id: 'a', updated_at: '2026-06-21T10:00:00Z' };
  const server = { id: 'a', updated_at: '2026-06-21T10:00:00Z' };
  assert.strictEqual(lwwWinner(local, server), 'server');
});
