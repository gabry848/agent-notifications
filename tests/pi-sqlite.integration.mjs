import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { NotificationStore } from '../src/store.mjs';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

test('Pi RPC retains SQLite data on restart and routes late events to their original session', { timeout: 30000 }, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'pi-sqlite-rpc-'));
  const config = join(directory, 'config');
  const databasePath = join(directory, 'notifications.sqlite');
  const tracePath = join(directory, 'trace.jsonl');
  mkdirSync(config);
  writeFileSync(join(config, 'settings.json'), JSON.stringify({ defaultProvider: 'openai', defaultModel: 'gpt-6.1-sol', packages: [] }));
  const probe = createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const processes = [];
  t.after(() => { processes.forEach(p => p.child.kill('SIGKILL')); rmSync(directory, { recursive: true, force: true }); });

  const start = async (sessionId, label, wildcardMode) => {
    const readyPath = join(directory, `${label}.ready.json`);
    const child = spawn(process.env.PI_BINARY ?? 'pi', [
      '--mode', 'rpc', '--offline', '--no-extensions', '--no-skills', '--no-prompt-templates',
      '--no-context-files', '--no-themes', '--no-approve', '--session-id', sessionId,
      '--session-dir', join(directory, 'sessions'), '--tools', 'notifications_dismiss,notifications_history',
      '-e', fileURLToPath(new URL(wildcardMode ? './fixtures/pi-wildcard-dismiss.ts' : '../src/pi-extension.ts', import.meta.url)),
    ], { cwd: directory, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env,
      PI_CODING_AGENT_DIR: config, PI_NOTIFY_DB: databasePath, PI_NOTIFY_PORT: String(port), PI_NOTIFY_LAB: '0',
      PI_NOTIFY_READY: readyPath, PI_NOTIFY_TRACE: tracePath, PI_TELEMETRY: '0',
      PI_NOTIFY_PROVIDER_TRACE: '', PI_NOTIFY_PROMPT: fileURLToPath(new URL('../prompts/v2.txt', import.meta.url)),
      ...(wildcardMode ? { PI_NOTIFY_DISMISS: wildcardMode, PI_NOTIFY_WILDCARD_RESULT: join(directory, `${label}.result.json`) } : {}) } });
    let stderr = ''; let buffer = ''; let failure; let exitCode; let serial = 0;
    const responses = new Map();
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', error => { failure = error; });
    child.once('exit', code => { exitCode = code; });
    child.stdout.on('data', chunk => {
      buffer += chunk;
      let i;
      while ((i = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, i); buffer = buffer.slice(i + 1);
        try { const event = JSON.parse(line); if (event.type === 'response') responses.set(event.id, event); }
        catch { /* Only JSONL protocol responses are relevant here. */ }
      }
    });
    const wait = async (check, label) => {
      const deadline = Date.now() + 7000;
      while (Date.now() < deadline) {
        const result = check(); if (result) return result;
        if (failure) throw failure;
        if (exitCode !== undefined) throw new Error(`Pi exited ${exitCode}: ${stderr}`);
        await pause(20);
      }
      throw new Error(`Timeout: ${label}; ${stderr}`);
    };
    const rpc = async command => {
      const id = `request-${++serial}`;
      child.stdin.write(JSON.stringify({ id, ...command }) + '\n');
      const response = await wait(() => responses.get(id), command.type);
      assert.equal(response.success, true, response.error);
      return response.data;
    };
    const ready = () => JSON.parse(readFileSync(readyPath, 'utf8'));
    const stop = async () => {
      child.stdin.end();
      await wait(() => exitCode !== undefined ? { exitCode } : null, 'shutdown');
      assert.equal(exitCode, 0, stderr);
      assert.ok(!stderr.includes('Extension error'), stderr);
    };
    const client = { child, rpc, ready, wait, stop };
    processes.push(client);
    await wait(() => existsSync(readyPath), 'HTTP endpoint');
    assert.equal(ready().sessionId, sessionId);
    assert.equal(ready().databasePath, databasePath);
    return client;
  };
  const post = async (url, body) => {
    const response = await fetch(url + '/notify', { method: 'POST', body: JSON.stringify(body), signal: AbortSignal.timeout(3000) });
    assert.equal(response.status, 201, await response.clone().text());
    return response.json();
  };

  const firstId = randomUUID();
  const first = await start(firstId, 'first');
  const initialUrl = first.ready().url;
  const active = await post(initialUrl, { source: 'CI', message: 'Active across restart' });
  const dismissed = await post(initialUrl, { source: 'Worker', message: 'Keep in history' });
  let store = new NotificationStore({ path: databasePath, sessionId: firstId });
  assert.equal(store.call, 0); // HTTP ingestion does not trigger an inference.
  store.snapshot(); store.snapshot();
  store.dismiss(dismissed.id); store.close();

  await first.rpc({ type: 'new_session' });
  await first.wait(() => first.ready().sessionId !== firstId, 'new session');
  const secondId = first.ready().sessionId;
  assert.equal(first.ready().url, initialUrl); // A configured port survives Pi's extension reload.
  const late = await post(initialUrl, { sessionId: firstId, source: 'CI', message: 'Late result for original session' });
  const other = await post(initialUrl, { source: 'CI', message: 'Second session result' });
  assert.equal(late.sessionId, firstId); assert.equal(other.sessionId, secondId);
  await first.stop();

  const restarted = await start(firstId, 'restarted');
  assert.equal((await restarted.rpc({ type: 'get_state' })).sessionId, firstId);
  store = new NotificationStore({ path: databasePath, sessionId: firstId });
  assert.equal(store.call, 2);
  const next = store.snapshot();
  assert.deepEqual(next.active.map(n => [n.id, n.turnAge]), [[active.id, 2], [late.id, 0]]);
  assert.ok(store.history().find(n => n.id === dismissed.id).dismissedAt);
  const second = store.forSession(secondId, { create: false });
  assert.equal(second.call, 0);
  assert.deepEqual(second.history().map(n => n.id), [other.id]);
  store.close();
  await restarted.stop();

  const resumedSecond = await start(secondId, 'second');
  store = new NotificationStore({ path: databasePath, sessionId: secondId });
  assert.equal(store.snapshot().active[0].id, other.id);
  store.close();
  await resumedSecond.stop();
  for (const mode of ['single', 'batch']) {
    const label = `wildcard-${mode}`;
    const client = await start(randomUUID(), label, mode);
    const reportPath = join(directory, `${label}.result.json`);
    await client.wait(() => existsSync(reportPath), 'offline wildcard tool result');
    const report = JSON.parse(readFileSync(reportPath, 'utf8'));
    const summary = { id: '*', found: true, dismissed: true, count: 2 };
    assert.deepEqual(report.response, mode === 'batch' ? { results: [summary] } : summary);
    const empty = { ...summary, count: 0 };
    assert.deepEqual(report.repeated, mode === 'batch' ? { results: [empty] } : empty);
    assert.equal(report.cleared, 0);
    assert.equal(report.historyRetained, true);
    assert.equal(report.otherSessionPreserved, true);
    assert.equal(report.laterArrivalPreserved, true);
    await client.stop();
  }
  const trace = readFileSync(tracePath, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
  assert.equal(trace.filter(e => e.type === 'provider_request').length, 0);
  assert.equal(readFileSync(databasePath).subarray(0, 16).toString(), 'SQLite format 3\0');
});
