import test from 'node:test';
import assert from 'node:assert/strict';
import * as view from '../src/pipeline/view.mjs';

const event = (overrides = {}) => ({
  eventId: 'a', source: 'CI', message: 'done', occurredAt: '2026-10-06T10:00:00Z',
  receivedCall: 2, target: 's', dismissedAt: null, ...overrides,
});

test('both age arguments and empty visibility limits are validated', () => {
  for (const invalid of [-1, 0.5, NaN, Infinity, '2', null]) {
    assert.throws(() => view.turnAge(2, invalid));
    assert.throws(() => view.turnAge(invalid, 2));
    assert.throws(() => view.visibleEvents([], 's', 2, invalid));
  }
  assert.throws(() => view.visibleEvents([], 's', -1, 0));
  assert.equal(view.turnAge(0, 0), 0);
});

test('compaction uses UTF-16 units and validates types', () => {
  assert.deepEqual(view.compactMessage('😀xy', 3), {text: '😀…', truncated: true});
  assert.deepEqual(view.compactMessage('😀', 2), {text: '😀', truncated: false});
  assert.equal(view.compactMessage('😀x', 2).text, '\ud83d…');
  for (const invalid of [null, 1, {}]) assert.throws(() => view.compactMessage(invalid));
  for (const invalid of [0, -1, 1.5, Infinity, '3']) assert.throws(() => view.compactMessage('', invalid));
});

test('visibility compares parsed timestamps, keeps receipt boundary, and never mutates', () => {
  const input = Object.freeze([
    Object.freeze(event({eventId: 'z', occurredAt: '2026-10-06T12:00:00+02:00', receivedCall: 5})),
    Object.freeze(event({eventId: 'b'})),
    Object.freeze(event({eventId: 'a', dismissedAt: undefined})),
    Object.freeze(event({eventId: 'hidden', dismissedAt: ''})),
  ]);
  const visible = view.visibleEvents(input, 's', 5, 2);
  assert.deepEqual(visible.map(e => e.eventId), ['b', 'z']);
  assert.equal(visible[1].turnAge, 0);
  assert.notEqual(visible[1], input[0]);
  assert.equal(input[0].turnAge, undefined);
});

test('verified 192-unit policy is used at the exact rendering boundary', () => {
  assert.equal(view.POLICY.maxMessageChars, 192);
  const prefix = '- [a] 2026-10-06T10:00:00Z t-0 CI: ';
  assert.equal(view.renderNotification(event({message: 'x'.repeat(192)}), 2), prefix + 'x'.repeat(192));
  assert.equal(view.renderNotification(event({message: 'x'.repeat(193)}), 2), prefix + 'x'.repeat(191) + '…');
});

test('rendering uses current policy and joins notifications chronologically', () => {
  const original = view.POLICY.maxMessageChars;
  try {
    view.POLICY.maxMessageChars = 3;
    const a = event({message: 'abcd'});
    const b = event({eventId: 'b', receivedCall: 6});
    assert.equal(view.renderNotification(a, 1), '- [a] 2026-10-06T10:00:00Z t-0 CI: ab…');
    assert.equal(view.renderContext([b, a], 's', 6),
      view.renderNotification(a, 6) + '\n' + view.renderNotification(b, 6));
    assert.equal(view.renderContext([a], 's', 6, 0), '');
  } finally {
    view.POLICY.maxMessageChars = original;
  }
});

test('grouping treats all prototype names as own keys and preserves input order', () => {
  const input = Object.freeze(['__proto__', 'constructor', 'toString', '__proto__'].map((source, i) =>
    Object.freeze(event({source, eventId: String(i)}))));
  const grouped = view.groupBySource(input);
  assert.deepEqual(grouped.__proto__, ['0', '3']);
  assert.deepEqual(grouped.constructor, ['1']);
  assert.deepEqual(grouped.toString, ['2']);
  assert.equal(Object.getPrototypeOf(grouped), Object.prototype);
  assert.deepEqual(Object.keys(grouped), ['__proto__', 'constructor', 'toString']);
  assert.deepEqual(view.groupBySource([]), {});
});
