import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Journal } from './src/journal.mjs';
import { SubscriptionRegistry } from './src/subscriptions.mjs';
import { RevisionTracker } from './src/dedupe.mjs';
import { createHubServer } from './src/server.mjs';
import { createHttpSender } from './src/sender.mjs';
import { loadPolicy } from './src/policy.mjs';
import { deliverAll } from './src/dispatcher.mjs';
import { sanitize } from './src/transform.mjs';
import { retryDelay } from './src/retry.mjs';

const listen = s => new Promise(resolve => s.listen(0, '127.0.0.1', resolve));
const close = s => new Promise(resolve => s.close(resolve));
const event = { id: 'integration', topic: 'hub.created', revision: 1, payload: { text: 'é'.repeat(150) } };
const policy = { maxPayloadBytes: 1024, retryCapMs: 150, preferredRegion: 'local', auditRevision: 0 };

test('real hub and receiver: durable routing, retry reload, request policy reload', async () => {
  const dir = mkdtempSync(join(process.cwd(), '.integration-'));
  const path = join(dir, 'policy.json'), db = join(dir, 'events.sqlite');
  writeFileSync(path, JSON.stringify(policy));
  let calls = 0;
  const bodies = [];
  const receiver = createServer(async (req, res) => {
    assert.equal(req.method, 'POST');
    assert.equal(req.headers['content-type'], 'application/json');
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    bodies.push(JSON.parse(Buffer.concat(chunks).toString()));
    calls++;
    res.writeHead(calls < 3 ? 503 : 200, { 'content-type': 'application/json', 'retry-after': '2' });
    res.end(JSON.stringify({ received: true }));
  });
  let journal = new Journal(db), hub;
  try {
    await listen(receiver);
    const registry = new SubscriptionRegistry();
    registry.upsert({ id: 's', url: `http://127.0.0.1:${receiver.address().port}`, patterns: ['hub.*', '**'], expiresAt: 10 });
    const makeHub = () => createHubServer({ registry, tracker: new RevisionTracker(), journal, now: () => 0, configPath: path });
    hub = makeHub(); await listen(hub);
    let url = `http://127.0.0.1:${hub.address().port}/events`;
    const post = () => fetch(url, { method: 'POST', body: JSON.stringify(event) });
    const response = await post();
    assert.equal(response.status, 202);
    const { deliveries } = await response.json();
    assert.equal(deliveries.length, 1);
    const waits = [];
    const send = createHttpSender({ fetchImpl: fetch, loadCurrentPolicy: () => loadPolicy(path), wait: async ms => {
      waits.push(ms);
      writeFileSync(path, JSON.stringify({ ...policy, retryCapMs: 75, auditRevision: 1 }));
    } });
    assert.deepEqual(await deliverAll(deliveries, send, { concurrency: 2 }), [{ ok: true, value: { received: true } }]);
    assert.deepEqual(waits, [150, 75]);
    assert.deepEqual(bodies, [event, event, event]);
    assert.deepEqual((await (await post()).json()).deliveries, []);
    await close(hub); journal.close();
    journal = new Journal(db); hub = makeHub(); await listen(hub);
    url = `http://127.0.0.1:${hub.address().port}/events`;
    assert.deepEqual((await (await post()).json()).deliveries, []);
    assert.deepEqual((await (await fetch(url)).json()).events, [event]);
    writeFileSync(path, JSON.stringify({ ...policy, maxPayloadBytes: 250 }));
    assert.equal((await post()).status, 413); // UTF-8 byte count, not character count
    assert.equal((await fetch(url, { method: 'POST', body: '{' })).status, 400);
  } finally {
    if (hub?.listening) await close(hub);
    if (receiver.listening) await close(receiver);
    journal.close(); rmSync(dir, { recursive: true, force: true });
  }
});

test('dispatcher fills freed slots without waiting for slow first delivery', async () => {
  const started = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const pending = deliverAll([0, 1, 2, 3], async n => {
    started.push(n);
    if (n === 0) await gate;
    if (n === 3) release();
    if (n === 2) throw new Error('one failure');
    return n;
  }, { concurrency: 2 });
  assert.deepEqual(await pending, [{ ok: true, value: 0 }, { ok: true, value: 1 }, { ok: false, error: 'one failure' }, { ok: true, value: 3 }]);
  assert.deepEqual(started, [0, 1, 2, 3]);
  await assert.rejects(deliverAll([], () => {}, { concurrency: 0 }), TypeError);
});

test('sender rejects nonretryable/exhausted statuses and does not retry transport failures', async () => {
  for (const status of [400, 429, 500]) {
    let calls = 0, waits = 0;
    const send = createHttpSender({ fetchImpl: async () => {
      calls++; return { ok: false, status, headers: { get: () => 'invalid' } };
    }, loadCurrentPolicy: () => policy, wait: async () => { waits++; }, maxAttempts: 2 });
    await assert.rejects(send({ url: 'http://localhost', event }), new RegExp(`HTTP ${status}`));
    assert.equal(calls, status === 400 ? 1 : 2);
    assert.equal(waits, calls - 1);
  }
  const send = createHttpSender({ fetchImpl: async () => { throw new Error('offline'); }, loadCurrentPolicy: () => policy, wait: async () => assert.fail('must not wait') });
  await assert.rejects(send({ url: 'http://localhost', event }), /offline/);
});

test('JSON special keys survive redaction and large retry attempts remain finite', () => {
  const input = JSON.parse('{"__proto__":{"token":"secret"},"arr":[null,false,0]}');
  const output = sanitize(input, ['token']);
  assert.equal(Object.getPrototypeOf(output), Object.prototype);
  assert.equal(output.__proto__.token, '[redacted]');
  assert.equal(input.__proto__.token, 'secret');
  assert.equal(retryDelay(Number.MAX_VALUE, { baseMs: 100, capMs: 4999 }), 4999);
});
