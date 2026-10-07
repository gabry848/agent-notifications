import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { NotificationStore } from '../src/store.mjs';
import { startNotificationServer } from '../src/http.mjs';

test('HTTP accepts events without making model calls and validates input', async () => {
  const store = new NotificationStore(); const received = [];
  const server = await startNotificationServer({ store, onReceive: n => received.push(n) });
  try {
    const post = body => fetch(server.url + '/notify', { method: 'POST', body: JSON.stringify(body) });
    assert.equal((await post({ source: 'CI', message: 'Passed' })).status, 201);
    assert.equal(store.call, 0);
    assert.equal(received.length, 1);
    assert.equal((await post({ source: '', message: 'Passed' })).status, 400);
    assert.equal((await post(null)).status, 400);
    assert.equal((await fetch(server.url + '/lab/release', { method: 'POST', body: '{}' })).status, 404);
  } finally { await server.close(); }
});

test('server follows the selected session store', async () => {
  let store = new NotificationStore(); const old = store;
  const server = await startNotificationServer({ store: () => store });
  try {
    store = new NotificationStore();
    await fetch(server.url + '/notify', { method: 'POST', body: JSON.stringify({ source: 'CI', message: 'New session' }) });
    assert.equal(old.history().length, 0);
    assert.equal(store.history().length, 1);
  } finally { await server.close(); }
});

test('explicit HTTP destinations remain attached to the original session after a switch', async () => {
  const database = new NotificationStore({ sessionId: 'a' });
  const a = database.forSession('a'); const b = database.forSession('b');
  let selected = a;
  const server = await startNotificationServer({ store: target => target === undefined
    ? selected : database.forSession(target, { create: false }) });
  try {
    selected = b;
    const post = body => fetch(server.url + '/notify', { method: 'POST', body: JSON.stringify(body) });
    assert.equal((await post({ sessionId: 'a', source: 'CI', message: 'Late result for A' })).status, 201);
    assert.equal((await post({ source: 'CI', message: 'Current session B' })).status, 201);
    assert.equal((await post({ sessionId: 'unknown', source: 'CI', message: 'Unknown' })).status, 400);
    assert.equal((await post({ sessionId: 123, source: 'CI', message: 'Invalid' })).status, 400);
    assert.equal(a.history()[0].message, 'Late result for A');
    assert.equal(b.history()[0].message, 'Current session B');
    assert.equal(a.call, 0); assert.equal(b.call, 0);
  } finally { await server.close(); database.close(); }
});

test('a UTF-8 message survives an HTTP chunk boundary inside a character', async () => {
  const store = new NotificationStore();
  const server = await startNotificationServer({ store });
  try {
    const payload = Buffer.from(JSON.stringify({ source: 'Processo', message: 'Operazione completata: caffè ☕' }));
    const split = payload.indexOf(Buffer.from('è')) + 1;
    const status = await new Promise((resolve, reject) => {
      const req = request(server.url + '/notify', { method: 'POST' }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
      req.on('error', reject);
      req.write(payload.subarray(0, split));
      setTimeout(() => req.end(payload.subarray(split)), 10);
    });
    assert.equal(status, 201);
    assert.equal(store.history()[0].message, 'Operazione completata: caffè ☕');
  } finally { await server.close(); }
});
