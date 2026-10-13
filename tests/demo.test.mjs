import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { prepareDemo, runCI, runDemoCI } from '../demo/ci.mjs';
import { NotificationStore } from '../src/store.mjs';
import { startNotificationServer } from '../src/http.mjs';

test('demo CI tests its captured source and delivers to its original Pi session', async t => {
  const directory = prepareDemo();
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const database = new NotificationStore({ sessionId: 'original' });
  const next = database.forSession('next');
  let active = database;
  const server = await startNotificationServer({ store: id => id === undefined ? active : database.forSession(id, { create: false }) });
  t.after(async () => { await server.close(); database.close(); });
  const readyPath = join(directory, '.pi/notifications-ready.json');
  writeFileSync(readyPath, JSON.stringify({ url: server.url, sessionId: 'original' }));

  const pending = runCI(directory, { delaySeconds: 1 });
  // Both source and active destination change after the original job was queued.
  active = next;
  writeFileSync(readyPath, JSON.stringify({ url: server.url, sessionId: 'next' }));
  const source = readFileSync(join(directory, 'shipping.mjs'), 'utf8');
  writeFileSync(join(directory, 'shipping.mjs'), source.replace('subtotal > 50', 'subtotal >= 50'));
  const failed = await pending;
  assert.equal(failed.conclusion, 'failure');
  assert.equal(failed.exitCode, 1);
  assert.match(readFileSync(failed.log, 'utf8'), /orders at \$50 qualify for free shipping/);
  assert.equal(readFileSync(join(failed.snapshot, 'shipping.mjs'), 'utf8'), source);
  assert.equal(database.call, 0); // Posting does not invoke inference or prepare context.
  assert.equal(next.history().length, 0);
  const delivered = database.history()[0];
  assert.equal(delivered.id, failed.notification.id);
  assert.equal(delivered.sessionId, 'original');
  assert.match(delivered.message, new RegExp(failed.revision));
  assert.ok(delivered.message.includes(failed.log));
  assert.equal(database.snapshot().active[0].id, delivered.id);

  // A subsequent job tests the fixed source and captures the newly selected session.
  const passed = await runCI(directory, { delaySeconds: 0 });
  assert.equal(passed.conclusion, 'success');
  assert.equal(passed.exitCode, 0);
  assert.notEqual(passed.revision, failed.revision);
  assert.equal(passed.notification.sessionId, 'next');
  assert.equal(next.history().length, 1);
  assert.match(readFileSync(passed.log, 'utf8'), /(?:# fail 0|ℹ fail 0)/);
});

test('demo refuses a missing receiver or a non-loopback destination before starting CI', async t => {
  const directory = prepareDemo();
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  await assert.rejects(runCI(directory, { delaySeconds: 0 }), /ENOENT/);
  writeFileSync(join(directory, '.pi/notifications-ready.json'), JSON.stringify({
    url: 'https://example.com', sessionId: 'original',
  }));
  await assert.rejects(runCI(directory, { delaySeconds: 0 }), /loopback Pi ready file/);
});

test('automatic demo CI waits for receiver readiness and records real delivery', async t => {
  const directory = prepareDemo();
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const database = new NotificationStore({ sessionId: 'automatic' });
  const server = await startNotificationServer({ store: database });
  t.after(async () => { await server.close(); database.close(); });
  const pending = runDemoCI(directory, { delaySeconds: 0 });
  await delay(30);
  assert.equal(existsSync(join(directory, '.demo/runs')), false);
  const readyPath = join(directory, '.pi/notifications-ready.json');
  // A reader can briefly observe an incomplete ready file during startup.
  writeFileSync(readyPath, '{');
  await delay(30);
  writeFileSync(readyPath, JSON.stringify({ url: server.url, sessionId: 'automatic' }));
  const report = await pending;
  assert.equal(report.conclusion, 'failure');
  assert.equal(database.history().length, 1);
  assert.equal(report.notification.sessionId, 'automatic');
  assert.match(readFileSync(join(directory, '.demo/ci-console.log'), 'utf8'), /CI failure; HTTP 201; notification/);
});

test('automatic demo CI cancels on Pi exit and reports a receiver startup timeout', async t => {
  const directory = prepareDemo();
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const controller = new AbortController();
  const pending = runDemoCI(directory, { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(existsSync(join(directory, '.demo/runs')), false);
  await assert.rejects(runDemoCI(directory, { readyTimeoutMs: 25 }), /receiver did not become ready/);
  assert.match(readFileSync(join(directory, '.demo/ci-console.log'), 'utf8'), /cancelled because Pi exited/);
  assert.match(readFileSync(join(directory, '.demo/ci-console.log'), 'utf8'), /Demo CI failed/);
});
