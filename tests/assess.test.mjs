import test from 'node:test';
import assert from 'node:assert/strict';
import { NotificationStore } from '../src/store.mjs';
import { assess } from '../experiments/assess.mjs';

test('provider verification distinguishes instructional references from the actual data block', () => {
  const store = new NotificationStore();
  const n = store.add({ source: 'CI', message: 'Batch 20' });
  const snapshot = store.snapshot();
  const assessment = assess({ spec: { notifications: [n], expected: { maxBatch: 20 } },
    result: { maxBatch: 20 }, received: [n], trace: [
      { type: 'notification_received', notification: n, lastContextCall: 0 },
      { type: 'context_snapshot', ...snapshot },
    ], providerRecords: [{ call: 1, attempt: 1, payload: { input: [
      { role: 'developer', content: 'Data appears in <runtime_notifications> tags.' },
      { role: 'user', content: [{ type: 'input_text', text: snapshot.block }] },
    ] } }] });
  assert.equal(assessment.injectionPass, true);
  assert.equal(assessment.behaviorPass, true);
});

test('a block missing from the provider request fails even if the hook saw it', () => {
  const store = new NotificationStore(); const snapshot = store.snapshot();
  const assessment = assess({ spec: { notifications: [], expected: {} }, result: {},
    received: [], trace: [{ type: 'context_snapshot', ...snapshot }], providerRecords: [{ call: 1, payload: {} }] });
  assert.equal(assessment.injectionPass, false);
});
