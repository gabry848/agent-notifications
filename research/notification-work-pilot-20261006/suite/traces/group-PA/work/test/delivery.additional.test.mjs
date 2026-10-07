import test from 'node:test';
import assert from 'node:assert/strict';
import * as x from '../src/pipeline/delivery.mjs';

test('retry supports subnormal bases, huge attempts, and finite caps', () => {
  assert.equal(x.retryDelay(1075, Number.MIN_VALUE, 10), 1);
  assert.equal(x.retryDelay(Number.MAX_VALUE, Number.MIN_VALUE, Number.MAX_VALUE), Number.MAX_VALUE);
  assert.equal(x.retryDelay(1, 200, 10), 10);
  for (const bad of [Infinity, NaN, 0, -1, '100']) {
    assert.throws(() => x.retryDelay(1, bad));
    assert.throws(() => x.retryDelay(1, 100, bad));
  }
});

test('initial identity escapes strings and rejects invalid identity/time', () => {
  const state = x.initialDelivery('a"\\', '\n', 0);
  assert.deepEqual(JSON.parse(state.id), ['a"\\', '\n']);
  for (const bad of ['', null, 1, undefined]) {
    assert.throws(() => x.initialDelivery(bad, 's', 0));
    assert.throws(() => x.initialDelivery('k', bad, 0));
  }
  for (const bad of [-1, Infinity, NaN, '0']) {
    assert.throws(() => x.initialDelivery('k', 's', bad));
    assert.throws(() => x.transitionDelivery(state, 'attempt', bad));
  }
});

test('transitions preserve fields, allow equal times, and reject forbidden edges', () => {
  const state = Object.freeze({ ...x.initialDelivery('k', 's', 10), meta: { tags: ['x'] } });
  const sending = x.transitionDelivery(state, 'attempt', 10);
  assert.equal(sending.availableAt, 10);
  sending.meta.tags.push('y');
  assert.deepEqual(state.meta.tags, ['x']);
  const delivered = x.transitionDelivery(sending, 'delivered', 10);
  assert.equal(delivered.attempts, 1);
  for (const status of ['pending', 'retry', 'sending', 'delivered', 'acked']) {
    for (const action of ['attempt', 'delivered', 'failed', 'ack']) {
      const valid = action === 'attempt' ? ['pending', 'retry'] : action === 'ack' ? ['delivered', 'acked'] : ['sending'];
      if (!valid.includes(status)) assert.throws(() => x.transitionDelivery({ ...state, status }, action, 10));
    }
  }
});

test('due queue includes exact boundary, sorts lexically and deeply copies', () => {
  const states = [
    { id: 'a', status: 'retry', availableAt: 2, meta: { list: [1] } },
    { id: 'Z', status: 'pending', availableAt: 2 },
    { id: 'old', status: 'pending', availableAt: 1 },
    { id: 'future', status: 'pending', availableAt: 3 },
    { id: 'sending', status: 'sending', availableAt: 0 },
  ];
  const result = x.dueDeliveries(states, 2);
  assert.deepEqual(result.map(s => s.id), ['old', 'Z', 'a']);
  result[2].meta.list.push(2);
  assert.deepEqual(states[0].meta.list, [1]);
  assert.equal(states[0].id, 'a');
});

test('summary rejects inherited names and total, with all empty counters', () => {
  assert.deepEqual(x.summarizeQueue([]), { pending: 0, sending: 0, retry: 0, delivered: 0, acked: 0, total: 0 });
  for (const status of ['constructor', '__proto__', 'total', undefined]) assert.throws(() => x.summarizeQueue([{ status }]));
});

test('merge collapses duplicates, favors incoming ties and keeps IDs distinct', () => {
  const existing = [{ id: 'a', updatedAt: 3, meta: { v: [1] } }, { id: 'a', updatedAt: 1 }];
  const incoming = [{ id: 'a', updatedAt: 3, meta: { v: [2] } }, { id: 'Z', updatedAt: 0 }];
  const result = x.mergeQueue(existing, incoming);
  assert.deepEqual(result.map(s => s.id), ['Z', 'a']);
  assert.deepEqual(result[1].meta.v, [2]);
  result[1].meta.v.push(3);
  assert.deepEqual(incoming[0].meta.v, [2]);
  assert.deepEqual(x.mergeQueue([], []), []);
});
