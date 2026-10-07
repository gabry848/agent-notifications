import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { NotificationStore } from '../src/store.mjs';

const exec = promisify(execFile);
const moduleUrl = new URL('../src/store.mjs', import.meta.url).href;
const fixture = t => {
  const directory = mkdtempSync(join(tmpdir(), 'pi-sqlite-test-'));
  const path = join(directory, 'nested', 'notifications.sqlite');
  const connections = [];
  t.after(() => { connections.forEach(s => s.close()); rmSync(directory, { recursive: true, force: true }); });
  return { path, open: sessionId => {
    const store = new NotificationStore({ path, sessionId });
    connections.push(store); return store;
  } };
};

test('restart preserves active notifications, dismissed history, IDs, timestamps and turn age', t => {
  const f = fixture(t); let store = f.open('session-a');
  const active = store.add({ source: 'CI', message: 'Pending follow-up' });
  const dismissed = store.add({ source: 'CI', message: 'Finished' });
  store.snapshot(); store.snapshot(); store.dismiss(dismissed.id);
  const unseen = store.add({ source: 'Worker', message: 'Arrived before restart' });
  store.close();
  store = f.open('session-a');
  assert.equal(store.call, 2);
  assert.equal(store.history().length, 3);
  assert.equal(store.history().find(n => n.id === active.id).createdAt, active.createdAt);
  assert.ok(store.history().find(n => n.id === dismissed.id).dismissedAt);
  assert.equal(store.history().find(n => n.id === unseen.id).firstVisibleCall, null);
  const snapshot = store.snapshot();
  assert.equal(snapshot.call, 3);
  assert.deepEqual(snapshot.active.map(n => [n.id, n.turnAge]), [[active.id, 2], [unseen.id, 0]]);
});

test('session views preserve independent counters and restrict history and dismiss', t => {
  const f = fixture(t); const a = f.open('a'); const b = a.forSession('b');
  const na = a.add({ source: 'CI', message: 'A only' });
  const nb = b.add({ source: 'CI', message: 'B only' });
  a.snapshot(); a.snapshot(); b.snapshot();
  assert.equal(a.call, 2); assert.equal(b.call, 1);
  assert.deepEqual(a.history().map(n => n.id), [na.id]);
  assert.deepEqual(b.history().map(n => n.id), [nb.id]);
  assert.equal(b.dismiss(na.id).found, false);
  assert.equal(a.forSession('a').snapshot().active[0].turnAge, 2);
  assert.throws(() => a.forSession('unknown', { create: false }), /Unknown/);
  assert.throws(() => a.forSession(''), /sessionId/);
});

test('wildcard dismissal persists across restart and preserves earlier dismiss timestamps', t => {
  const f = fixture(t);
  let time = new Date('2026-10-06T12:00:00Z');
  let store = f.open('bulk'); store.clock = () => time;
  const previous = store.add({ source: 'CI', message: 'Already handled' });
  store.dismiss(previous.id);
  store.add({ source: 'CI', message: 'First active' });
  store.add({ source: 'CI', message: 'Second active' });
  time = new Date('2026-10-06T12:01:00Z');
  assert.equal(store.dismiss('*').count, 2);
  store.close();

  store = f.open('bulk');
  assert.equal(store.call, 0);
  assert.equal(store.snapshot().active.length, 0);
  const history = store.history();
  assert.equal(history.length, 3);
  assert.equal(history.find(n => n.id === previous.id).dismissedAt, '2026-10-06T12:00:00.000Z');
  assert.ok(history.filter(n => n.id !== previous.id).every(n => n.dismissedAt === time.toISOString()));
});

test('an interrupted wildcard update leaves the whole queue active', t => {
  const store = fixture(t).open('bulk');
  store.add({ source: 'CI', message: 'First active' });
  const second = store.add({ source: 'CI', message: 'Second active' });
  store.db.prepare(`CREATE TRIGGER fail_bulk BEFORE UPDATE OF dismissed_at ON notifications
    WHEN OLD.id = '${second.id}' BEGIN SELECT RAISE(ABORT, 'injected bulk failure'); END;`).run();
  assert.throws(() => store.dismiss('*'), /injected bulk failure/);
  assert.ok(store.history().every(n => n.dismissedAt === null));
  assert.equal(store.snapshot().active.length, 2);
});

test('an interrupted snapshot rolls back both the counter and first-exposure updates', t => {
  const store = fixture(t).open('session');
  store.add({ source: 'CI', message: 'Result' });
  store.db.exec(`CREATE TRIGGER fail_snapshot BEFORE UPDATE OF first_visible_call ON notifications
    BEGIN SELECT RAISE(ABORT, 'injected snapshot failure'); END;`);
  assert.throws(() => store.snapshot(), /injected snapshot failure/);
  assert.equal(store.call, 0);
  assert.equal(store.history()[0].firstVisibleCall, null);
  store.db.exec('DROP TRIGGER fail_snapshot');
  assert.equal(store.snapshot().active[0].turnAge, 0);
  assert.equal(store.call, 1);
});

test('separate processes serialize writes and snapshot counters without losing events', { timeout: 15000 }, async t => {
  const f = fixture(t); f.open('shared').close();
  const code = `import { NotificationStore } from ${JSON.stringify(moduleUrl)};
    const store = new NotificationStore({ path: process.argv[1], sessionId: 'shared' });
    for (let i = 0; i < 3; i++) {
      store.add({ source: 'Worker', message: 'Completed ' + i });
      store.snapshot();
    }
    store.close();`;
  await Promise.all(Array.from({ length: 4 }, () => exec(process.execPath, ['--input-type=module', '-e', code, f.path], { timeout: 10000 })));
  const store = f.open('shared');
  assert.equal(store.call, 12);
  const history = store.history({ limit: 200 });
  assert.equal(history.length, 12);
  assert.equal(new Set(history.map(n => n.id)).size, 12);
  assert.ok(history.every(n => n.firstVisibleCall >= 1 && n.firstVisibleCall <= 12));
});

test('a committed notification survives SIGKILL before the connection is closed', { timeout: 10000 }, async t => {
  const f = fixture(t);
  const code = `import { NotificationStore } from ${JSON.stringify(moduleUrl)};
    const store = new NotificationStore({ path: process.argv[1], sessionId: 'crash' });
    process.stdout.write(JSON.stringify(store.add({ source: 'Worker', message: 'Durable result' })) + '\\n');
    setInterval(() => {}, 1000);`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', code, f.path], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  const record = await new Promise((resolve, reject) => {
    let data = ''; let errors = '';
    child.stderr.on('data', chunk => { errors += chunk; });
    child.once('error', reject);
    child.once('exit', code => reject(new Error(`Child exited before commit: ${code}; ${errors}`)));
    child.stdout.on('data', chunk => {
      data += chunk;
      if (data.includes('\n')) resolve(JSON.parse(data.split('\n')[0]));
    });
  });
  const exited = new Promise(resolve => child.once('exit', resolve));
  child.kill('SIGKILL'); await exited;
  const store = f.open('crash');
  assert.equal(store.history()[0].id, record.id);
  assert.equal(store.snapshot().active[0].message, 'Durable result');
});

test('a newer schema version is rejected without replacing the database', t => {
  const f = fixture(t); f.open('a').close();
  let db = new DatabaseSync(f.path); db.exec('PRAGMA user_version = 9'); db.close();
  assert.throws(() => f.open('a'), /Unsupported.*9/);
  db = new DatabaseSync(f.path);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 9);
  db.close();
});
