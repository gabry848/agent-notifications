import test from 'node:test';
import assert from 'node:assert/strict';
import * as view from '../src/pipeline/view.mjs';

const event = (overrides = {}) => ({
  eventId: 'a', source: 'CI', message: 'done',
  occurredAt: '2026-10-06T10:00:00Z', receivedCall: 2,
  target: 'session', dismissedAt: null, ...overrides
});

test('numeric validation applies to both ages, empty visibility, and zero caps', () => {
  for (const invalid of [-1, 0.5, NaN, Infinity, '2', null, undefined]) {
    assert.throws(() => view.turnAge(2, invalid));
    assert.throws(() => view.turnAge(invalid, 2));
    assert.throws(() => view.visibleEvents([], 'session', invalid, 0));
    if (invalid !== undefined) assert.throws(() => view.visibleEvents([], 'session', 2, invalid));
  }
  assert.equal(view.turnAge(0, 0), 0);
  assert.throws(() => view.renderContext([], 'session', -1));
});

test('compaction counts UTF-16 units and rejects invalid inputs', () => {
  assert.deepEqual(view.compactMessage('😀x', 2), {text: '\ud83d…', truncated: true});
  assert.deepEqual(view.compactMessage('😀', 2), {text: '😀', truncated: false});
  for (const value of [0, -1, 1.5, NaN, Infinity, '3', null]) {
    assert.throws(() => view.compactMessage('abc', value));
  }
  for (const value of [null, 12, {}, ['a']]) assert.throws(() => view.compactMessage(value));
});

test('visibility uses parsed timestamps, ID tie breaks, and clones frozen inputs', () => {
  const events = Object.freeze([
    Object.freeze(event({eventId: 'z', occurredAt: '2026-10-06T11:00:00+01:00'})),
    Object.freeze(event({eventId: 'b', occurredAt: '2026-10-06T09:30:00Z'})),
    Object.freeze(event({eventId: 'a', dismissedAt: undefined})),
    Object.freeze(event({eventId: 'dismissed', dismissedAt: ''})),
    Object.freeze(event({eventId: 'future', receivedCall: 4}))
  ]);
  const visible = view.visibleEvents(events, 'session', 2, 2);
  assert.deepEqual(visible.map(e => e.eventId), ['a', 'z']);
  assert.equal(visible[0].turnAge, 0);
  assert.notEqual(visible[0], events[2]);
  assert.equal(events[2].turnAge, undefined);
  assert.equal(view.visibleEvents(events, 'session', 2).length, 3);
});

test('default visibility limit keeps the most recent 50 in chronological order', () => {
  const events = Array.from({length: 52}, (_, i) => event({
    eventId: String(i).padStart(2, '0')
  })).reverse();
  const visible = view.visibleEvents(events, 'session', 2);
  assert.equal(visible.length, 50);
  assert.equal(visible[0].eventId, '02');
  assert.equal(visible.at(-1).eventId, '51');
  assert.equal(events[0].eventId, '51');
  assert.deepEqual(view.visibleEvents([], 'session', 2, undefined), []);
});

test('diagnostic policy caps default rendering at 192 UTF-16 units', () => {
  assert.equal(view.POLICY.maxMessageChars, 192);
  assert.deepEqual(view.compactMessage('a'.repeat(192)), {text: 'a'.repeat(192), truncated: false});
  assert.deepEqual(view.compactMessage('a'.repeat(193)), {text: 'a'.repeat(191) + '…', truncated: true});
  assert.equal(view.renderNotification(event({message: 'a'.repeat(193)}), 2),
    '- [a] 2026-10-06T10:00:00Z t-0 CI: ' + 'a'.repeat(191) + '…');
});

test('rendering reads current policy and context uses the chronological cap', () => {
  const previous = view.POLICY.maxMessageChars;
  try {
    view.POLICY.maxMessageChars = 3;
    const a = event({message: 'abcd'});
    assert.equal(view.renderNotification(a, 1), '- [a] 2026-10-06T10:00:00Z t-0 CI: ab…');
    assert.equal(view.renderContext([a, event({eventId: 'b'})], 'session', 2, 1),
      '- [b] 2026-10-06T10:00:00Z t-0 CI: do…');
    assert.equal(view.renderContext([a], 'session', 2, 0), '');
  } finally {
    view.POLICY.maxMessageChars = previous;
  }
});

test('grouping safely handles all prototype keys without changing frozen events', () => {
  const events = Object.freeze(['__proto__', 'constructor', 'toString', '__proto__']
    .map((source, i) => Object.freeze(event({source, eventId: String(i)}))));
  const groups = view.groupBySource(events);
  assert.equal(Object.getPrototypeOf(groups), null);
  assert.deepEqual(groups.__proto__, ['0', '3']);
  assert.deepEqual(groups.constructor, ['1']);
  assert.deepEqual(groups.toString, ['2']);
  assert.deepEqual(Object.keys(view.groupBySource([])), []);
});
