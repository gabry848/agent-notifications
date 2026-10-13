import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { NotificationStore } from '../src/store.mjs';

test('demo launch automatically submits the task to Pi in the fresh workspace', { timeout: 15000 }, async () => {
  const project = fileURLToPath(new URL('../', import.meta.url));
  const execute = promisify(execFile);
  const temporary = mkdtempSync(join(tmpdir(), 'hn-demo-startup-'));
  const config = join(temporary, 'pi-config');
  const wrapper = join(temporary, 'offline-pi');
  const probe = join(temporary, 'input-probe.ts');
  const capture = join(temporary, 'input.json');
  mkdirSync(config);
  writeFileSync(join(config, 'settings.json'), JSON.stringify({ defaultProvider: 'openai', defaultModel: 'gpt-6.1-sol', packages: [] }));
  // Observe Pi's actual startup input, then handle it before any provider request.
  writeFileSync(probe, `import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
export default function (pi) {
  pi.on('input', (event, ctx) => {
    writeFileSync(process.env.HN_DEMO_INPUT_CAPTURE, JSON.stringify({
      text: event.text, source: event.source, cwd: ctx.cwd,
      task: readFileSync(join(ctx.cwd, '.demo/task.txt'), 'utf8'),
      ready: JSON.parse(readFileSync(process.env.PI_NOTIFY_READY, 'utf8')),
    }));
    return { action: 'handled' };
  });
}
`);
  writeFileSync(wrapper, '#!/bin/sh\nexec "$HN_DEMO_PI_BINARY" --print --offline --no-themes --no-approve -e "$HN_DEMO_INPUT_PROBE" "$@"\n', { mode: 0o700 });
  const environment = { ...process.env, PI_BINARY: wrapper, HN_DEMO_PI_BINARY: process.env.PI_BINARY ?? 'pi',
    PI_CODING_AGENT_DIR: config, PI_TELEMETRY: '0', HN_DEMO_INPUT_PROBE: probe, HN_DEMO_INPUT_CAPTURE: capture };
  delete environment.NODE_TEST_CONTEXT;
  let workspace;
  try {
    const pending = execute(process.execPath, [join(project, 'demo/ci.mjs'), 'launch'], {
      cwd: project, env: environment, timeout: 10000,
    });
    pending.child.stdin.end();
    const { stdout, stderr } = await pending;
    workspace = stdout.match(/Demo workspace: ([^\n]+)/)?.[1];
    assert.ok(workspace, stdout);
    assert.ok(existsSync(capture), 'Pi never received the demo task at startup');
    const input = JSON.parse(readFileSync(capture, 'utf8'));
    assert.equal(input.text, 'Read .demo/task.txt and carry out the task.');
    assert.equal(input.source, 'interactive');
    assert.equal(realpathSync(input.cwd), realpathSync(workspace));
    assert.match(input.task, /formatReceipt\(items\)/);
    assert.ok(input.ready.sessionId);
    assert.equal(readFileSync(join(workspace, '.demo/runtime.jsonl'), 'utf8').includes('provider_request'), false);
    assert.equal(stderr.includes('Extension error'), false, stderr);
  } catch (error) {
    workspace ??= error.stdout?.match(/Demo workspace: ([^\n]+)/)?.[1];
    throw error;
  } finally {
    if (workspace) rmSync(workspace, { recursive: true, force: true });
    rmSync(temporary, { recursive: true, force: true });
  }
});

test('clean source demo launcher automatically delivers CI to the actual Pi receiver without inference', { timeout: 20000 }, async () => {
  const project = fileURLToPath(new URL('../', import.meta.url));
  const execute = promisify(execFile);
  const temporary = mkdtempSync(join(tmpdir(), 'hn-clean-source-'));
  const source = join(temporary, 'source');
  const config = join(temporary, 'pi-config');
  const wrapper = join(temporary, 'offline-pi');
  mkdirSync(source); mkdirSync(config);
  for (const name of ['src', 'prompts', 'demo']) cpSync(join(project, name), join(source, name), { recursive: true });
  writeFileSync(join(config, 'settings.json'), JSON.stringify({ defaultProvider: 'openai', defaultModel: 'gpt-6.1-sol', packages: [] }));
  // Preserve normal launcher behavior, but replace the interactive host with offline RPC.
  writeFileSync(wrapper, '#!/bin/sh\nexec "$HN_DEMO_PI_BINARY" --mode rpc --offline --no-themes --no-approve "$@"\n', { mode: 0o700 });
  const environment = { ...process.env, PI_BINARY: wrapper, HN_DEMO_PI_BINARY: process.env.PI_BINARY ?? 'pi',
    PI_CODING_AGENT_DIR: config, PI_TELEMETRY: '0' };
  delete environment.NODE_TEST_CONTEXT;
  const child = spawn(process.execPath, [join(source, 'demo/ci.mjs'), 'launch'], {
    cwd: source, stdio: ['pipe', 'pipe', 'pipe'], env: environment,
  });
  let output = ''; let errors = ''; let stopped = false; let failure; let workspace;
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { errors += chunk; });
  child.on('error', error => { failure = error; });
  child.on('exit', () => { stopped = true; });
  const waitFor = async check => {
    const deadline = Date.now() + 12000;
    while (Date.now() < deadline) {
      const result = check(); if (result) return result;
      if (failure) throw failure;
      if (stopped) throw new Error('Launcher stopped: ' + errors + output);
      await delay(25);
    }
    throw new Error('Timeout: ' + errors);
  };
  try {
    workspace = await waitFor(() => output.match(/Demo workspace: ([^\n]+)/)?.[1]);
    const readyPath = join(workspace, '.pi/notifications-ready.json');
    await waitFor(() => existsSync(readyPath));
    const ready = JSON.parse(readFileSync(readyPath, 'utf8'));
    child.stdin.write(JSON.stringify({ id: 'state', type: 'get_state' }) + '\n');
    await waitFor(() => output.includes('"id":"state"'));
    const state = JSON.parse(output.split('\n').find(line => line.startsWith('{') && line.includes('"id":"state"')));
    assert.equal(state.success, true);
    assert.equal(state.data.sessionId, ready.sessionId);
    // Launch alone must queue and deliver the initial failing CI result.
    const workerLog = join(workspace, '.demo/ci-console.log');
    await waitFor(() => existsSync(workerLog) && readFileSync(workerLog, 'utf8').includes('CI failure; HTTP 201'));
    const trace = readFileSync(join(workspace, '.demo/runtime.jsonl'), 'utf8');
    assert.match(trace, /notification_received/);
    const ci = () => execute(process.execPath, [join(source, 'demo/ci.mjs'), 'ci', workspace, '--delay', '0'], { env: environment, timeout: 5000 });
    let database = new NotificationStore({ path: ready.databasePath, sessionId: ready.sessionId });
    try {
      assert.equal(database.call, 0);
      assert.equal(database.history().length, 1);
      assert.match(database.history()[0].message, /orders at \$50 qualify for free shipping/);
      assert.equal(database.history()[0].firstVisibleCall, null);
    } finally { database.close(); }
    const file = join(workspace, 'shipping.mjs');
    writeFileSync(file, readFileSync(file, 'utf8').replace('subtotal > 50', 'subtotal >= 50'));
    const passed = await ci();
    assert.match(passed.stdout, /CI success; HTTP 201/);
    database = new NotificationStore({ path: ready.databasePath, sessionId: ready.sessionId });
    try {
      assert.equal(database.call, 0);
      assert.equal(database.history().length, 2);
    } finally { database.close(); }
    assert.equal(existsSync(join(source, 'node_modules')), false);
    assert.equal(readFileSync(join(workspace, '.demo/runtime.jsonl'), 'utf8').includes('provider_request'), false);
    assert.equal(errors.includes('Extension error'), false);
  } finally {
    child.stdin.end();
    for (let attempt = 0; !stopped && attempt < 200; attempt++) await delay(10);
    if (!stopped) child.kill('SIGKILL');
    if (workspace) rmSync(workspace, { recursive: true, force: true });
    rmSync(temporary, { recursive: true, force: true });
  }
});
