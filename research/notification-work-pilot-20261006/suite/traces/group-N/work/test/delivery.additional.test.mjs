import test from 'node:test';
import assert from 'node:assert/strict';
import * as delivery from '../src/pipeline/delivery.mjs';

test('retry handles extreme exponents and subnormal bases without premature overflow', () => {
  assert.equal(delivery.retryDelay(Number.MAX_VALUE), 10000);
  assert.equal(delivery.retryDelay(1075, Number.MIN_VALUE, 10000), 1);
  assert.equal(delivery.retryDelay(1, 100, 5), 5);
  for (const value of [Infinity, NaN, 0, -1, '100']) {
    assert.throws(() => delivery.retryDelay(1, value));
    assert.throws(() => delivery.retryDelay(1, 100, value));
  }
});

test('initial state rejects invalid keys and times', () => {
  for (const key of ['', null, 7]) {
    assert.throws(() => delivery.initialDelivery(key, 'target', 0));
    assert.throws(() => delivery.initialDelivery('key', key, 0));
  }
  for (const now of [-1, NaN, Infinity, '0']) {
    assert.throws(() => delivery.initialDelivery('key', 'target', now));
    assert.throws(() => delivery.transitionDelivery(delivery.initialDelivery('k', 't', 0), 'attempt', now));
  }
});

test('transitions preserve unrelated data and allow equal timestamps', () => {
  const initial = { ...delivery.initialDelivery('k', 't', 10), meta: { tags: ['original'] } };
  Object.freeze(initial);
  const sending = delivery.transitionDelivery(initial, 'attempt', 10);
  const failed = delivery.transitionDelivery(sending, 'failed', 10);
  assert.equal(failed.availableAt, 110);
  assert.equal(failed.attempts, 1);
  failed.meta.tags.push('new');
  assert.deepEqual(initial.meta.tags, ['original']);
  const sent = delivery.transitionDelivery(sending, 'delivered', 10);
  assert.equal(sent.availableAt, 10);
  for (const action of ['attempt', 'failed', 'delivered']) {
    assert.throws(() => delivery.transitionDelivery(sent, action, 11));
  }
});

test('due items include exact boundary, order lexically, and are deep copies', () => {
  const states = [
    { id: 'z', status: 'pending', availableAt: 2, meta: { n: 1 } },
    { id: 'a', status: 'retry', availableAt: 2 },
    { id: 'A', status: 'pending', availableAt: 2 },
    { id: 'early', status: 'retry', availableAt: 1 },
    { id: 'future', status: 'pending', availableAt: 3 },
    { id: 'sending', status: 'sending', availableAt: 0 },
  ];
  const result = delivery.dueDeliveries(states, 2);
  assert.deepEqual(result.map(s => s.id), ['early', 'A', 'a', 'z']);
  result[3].meta.n = 99;
  assert.equal(states[0].meta.n, 1);
  assert.equal(states[0].id, 'z');
});

test('summaries handle empty queues and reject prototype-like statuses', () => {
  assert.deepEqual(delivery.summarizeQueue([]), { pending: 0, sending: 0, retry: 0, delivered: 0, acked: 0, total: 0 });
  for (const status of ['total', 'toString', '__proto__', undefined]) {
    assert.throws(() => delivery.summarizeQueue([{ status }]));
  }
});

test('merge resolves duplicate IDs, respects newer existing records, and detaches arrays', () => {
  const existing = [{ id: '__proto__', updatedAt: 8, meta: { tags: ['old'] } }];
  const incoming = [
    { id: '__proto__', updatedAt: 7 },
    { id: 'a', updatedAt: 1 },
    { id: 'a', updatedAt: 1, meta: { tags: ['winner'] } },
  ];
  const result = delivery.mergeQueue(existing, incoming);
  assert.deepEqual(result.map(s => s.id), ['__proto__', 'a']);
  result[0].meta.tags.push('changed');
  result[1].meta.tags.push('changed');
  assert.deepEqual(existing[0].meta.tags, ['old']);
  assert.deepEqual(incoming[2].meta.tags, ['winner']);
  assert.deepEqual(delivery.mergeQueue([], []), []);
});
