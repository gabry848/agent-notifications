import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEvent, normalizeSubscriptions, recipientsFor, newestByEntity, routeBatch } from '../src/pipeline/ingest.mjs';

const event = overrides => ({ producer: 'p', entityId: 'e', topic: 'build', revision: 0,
  occurredAt: '2026-10-06T10:00:00Z', body: { nested: [{ value: 1 }] }, ...overrides });

test('object parsing deeply clones and discards unknown fields', () => {
  const input = event({ extra: 'discard' });
  const parsed = parseEvent(input);
  assert.deepEqual(Object.keys(parsed), ['producer', 'entityId', 'topic', 'revision', 'occurredAt', 'body']);
  parsed.body.nested[0].value = 9;
  assert.equal(input.body.nested[0].value, 1);
  for (const bad of [event({ revision: NaN }), event({ revision: Infinity }),
    event({ producer: 3 }), event({ entityId: '' }), event({ body: null }),
    event({ occurredAt: 'October 6, 2026' }), '{']) {
    assert.throws(() => parseEvent(bad));
  }
});

test('subscription validation, defaults, inactive merges and exact topic matching', () => {
  const input = [
    { sessionId: '__proto__', topics: ['build'], active: false },
    { sessionId: '__proto__', topics: ['build', 'other'], active: false },
    { sessionId: 'A', topics: ['build-more'] },
    { sessionId: 'z', topics: [] },
    { sessionId: 'a', topics: ['build'], active: 0 },
  ];
  const before = structuredClone(input);
  assert.deepEqual(recipientsFor(event(), input), ['a']);
  assert.equal(normalizeSubscriptions(input).find(s => s.sessionId === '__proto__').active, false);
  assert.deepEqual(input, before);
  for (const bad of [null, {}, [null], [{ sessionId: 'x', topics: 'build' }],
    [{ sessionId: 'x', topics: [''] }], [{ sessionId: 'x', topics: Array(1) }]]) {
    assert.throws(() => normalizeSubscriptions(bad));
  }
  assert.deepEqual(normalizeSubscriptions([]), []);
});

test('entity identity is collision-free, sorting is lexical, timestamp ties are numeric', () => {
  const events = [event({ producer: 'a/b', entityId: 'c' }),
    event({ producer: 'a', entityId: 'b/c' }),
    event({ producer: 'A', body: { first: true } }),
    event({ producer: 'A', occurredAt: '2026-10-06T12:00:00+02:00', body: { first: false } }),
    event({ producer: 'A', revision: 1, occurredAt: '2026-10-05T00:00:00Z', body: { newer: true } })];
  const before = structuredClone(events);
  const result = newestByEntity(events);
  assert.deepEqual(result.map(e => [e.producer, e.entityId]), [['A', 'e'], ['a', 'b/c'], ['a/b', 'c']]);
  assert.deepEqual(result[0].body, { newer: true });
  assert.deepEqual(newestByEntity(events.slice(2, 4))[0].body, { first: true });
  assert.deepEqual(events, before);
});

test('batch deliveries are ordered and independently cloned', () => {
  const inputs = [event({ entityId: 'z' }), event({ entityId: 'a' })];
  const results = routeBatch(inputs, [{ sessionId: 'z', topics: ['*'] }, { sessionId: 'a', topics: ['build'] }]);
  assert.deepEqual(results.map(r => [r.event.entityId, r.target]), [['a', 'a'], ['a', 'z'], ['z', 'a'], ['z', 'z']]);
  results[0].event.body.nested[0].value = 8;
  assert.equal(results[1].event.body.nested[0].value, 1);
  assert.equal(inputs[1].body.nested[0].value, 1);
  assert.deepEqual(routeBatch([], []), []);
});
