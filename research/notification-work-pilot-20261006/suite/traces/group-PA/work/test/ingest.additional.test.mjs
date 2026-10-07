import test from 'node:test';
import assert from 'node:assert/strict';
import * as ingest from '../src/pipeline/ingest.mjs';

const event = (overrides = {}) => ({
  producer: 'p', entityId: 'e', topic: 'build', revision: 0,
  occurredAt: '2026-10-06T10:00:00Z', body: { nested: [{ value: 1 }] }, ...overrides,
});

test('parser rejects invalid types and non-ISO dates, deeply detaches object input', () => {
  const input = event({ extra: true });
  const parsed = ingest.parseEvent(input);
  assert.deepEqual(Object.keys(parsed), ['producer', 'entityId', 'topic', 'revision', 'occurredAt', 'body']);
  parsed.body.nested[0].value = 2;
  assert.equal(input.body.nested[0].value, 1);
  for (const overrides of [
    { producer: '' }, { entityId: 1 }, { topic: null }, { revision: '0' },
    { revision: NaN }, { revision: Infinity }, { occurredAt: 0 },
    { occurredAt: 'October 6, 2026' }, { occurredAt: '2026-99-99' }, { body: null },
  ]) assert.throws(() => ingest.parseEvent(event(overrides)));
  assert.throws(() => ingest.parseEvent('{'));
  for (const occurredAt of ['2026-10-06', '+012026-10-06T10:00:00Z']) {
    assert.equal(ingest.parseEvent(event({ occurredAt })).occurredAt, occurredAt);
  }
});

test('subscription merging handles empty topics, false-only inactivity and unusual identifiers', () => {
  const input = [
    { sessionId: '__proto__', topics: ['z', 'A', 'z'], active: false },
    { sessionId: '__proto__', topics: ['a'], active: false },
    { sessionId: 'empty', topics: [] },
    { sessionId: 'enabled', topics: ['*'], active: 0 },
  ];
  const copy = structuredClone(input);
  assert.deepEqual(ingest.normalizeSubscriptions(input), [
    { sessionId: '__proto__', topics: ['A', 'a', 'z'], active: false },
    { sessionId: 'empty', topics: [], active: true },
    { sessionId: 'enabled', topics: ['*'], active: true },
  ]);
  assert.deepEqual(ingest.recipientsFor(event(), input), ['enabled']);
  assert.deepEqual(input, copy);
  for (const invalid of [null, {}, [null], [{ sessionId: 'a', topics: 'x' }],
    [{ sessionId: 'a', topics: [''] }], [{ sessionId: 'a', topics: [1] }],
    [{ sessionId: 'a', topics: new Array(1) }]]) {
    assert.throws(() => ingest.normalizeSubscriptions(invalid));
  }
});

test('entity keys do not collide, output sorting is lexical and timestamp ties are instants', () => {
  const input = [
    event({ producer: 'a/b', entityId: 'c' }),
    event({ producer: 'a', entityId: 'b/c' }),
    event({ producer: 'A', body: { winner: 'first' } }),
    event({ producer: 'A', occurredAt: '2026-10-06T12:00:00+02:00', body: { winner: 'second' } }),
    event({ producer: 'A', revision: 1, occurredAt: '2026-10-05T00:00:00Z', body: { winner: 'revision' } }),
  ];
  const copy = structuredClone(input);
  const output = ingest.newestByEntity(input);
  assert.deepEqual(output.map(e => [e.producer, e.entityId]), [['A', 'e'], ['a', 'b/c'], ['a/b', 'c']]);
  assert.equal(output[0].body.winner, 'revision');
  assert.equal(ingest.newestByEntity(input.slice(2, 4))[0].body.winner, 'first');
  output[1].body.nested[0].value = 4;
  assert.deepEqual(input, copy);
});

test('batch selects newest topic before routing, orders entities then targets and isolates deliveries', () => {
  const inputs = [event({ entityId: 'z' }), event({ entityId: 'a', revision: 0 }),
    event({ entityId: 'a', revision: 1, topic: 'other' })];
  const subscriptions = [{ sessionId: 'z', topics: ['*'] }, { sessionId: 'a', topics: ['build'] }];
  const output = ingest.routeBatch(inputs, subscriptions);
  assert.deepEqual(output.map(({ target, event }) => [event.entityId, target]), [['a', 'z'], ['z', 'a'], ['z', 'z']]);
  output[1].event.body.nested[0].value = 9;
  assert.equal(output[2].event.body.nested[0].value, 1);
  assert.equal(inputs[0].body.nested[0].value, 1);
  assert.deepEqual(ingest.newestByEntity([]), []);
  assert.deepEqual(ingest.routeBatch([], []), []);
});
