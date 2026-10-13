import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const execute = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const runner = fileURLToPath(import.meta.url);
const fixtureFiles = ['shipping.mjs', 'shipping.test.mjs'];
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const json = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n');

export function prepareDemo() {
  const directory = mkdtempSync(join(tmpdir(), 'agent-notifications-demo-'));
  cpSync(join(root, 'demo/fixture'), directory, { recursive: true });
  mkdirSync(join(directory, '.pi'));
  mkdirSync(join(directory, '.demo'));
  json(join(directory, '.demo/project.json'), { type: 'agent-notifications-hn-demo', version: 1 });
  writeFileSync(join(directory, '.demo/task.txt'), `Work on this tiny checkout while a local CI worker runs in another terminal.

First build an independent receipt formatter in receipt.mjs. Export
formatReceipt(items), where each item has a name, quantity and unitPrice.
Return lines such as "Notebook x2: $12.00" plus a final "Subtotal: $12.00".
Add receipt.test.mjs covering multiple items, an empty cart and decimal prices.
Run those tests, then document the formatter with examples in README.md.

Leave shipping.mjs and shipping.test.mjs unchanged until a CI result arrives.
Do not poll for CI, read .demo/ci-console.log or query notification history to
check for arrivals. Use the result provided in your runtime notifications.
If it reports a failure, inspect its log and compare the tested snapshot with
the current shipping files before deciding whether a fix is still needed.
Fix any applicable shipping bug and run both shipping and receipt tests.
Dismiss that specific notification after handling it, then summarize the result.
If you finish the independent work before CI arrives, say so and finish the turn.
Arrival does not wake an idle agent; the user can send a normal follow-up prompt.
`);
  return directory;
}

export async function runCI(directory, { delaySeconds = 8, signal, log = console.log } = {}) {
  directory = resolve(directory);
  const marker = JSON.parse(readFileSync(join(directory, '.demo/project.json'), 'utf8'));
  if (marker.type !== 'agent-notifications-hn-demo' || marker.version !== 1) {
    throw new Error('Use a workspace created by the demo setup command.');
  }
  if (!Number.isInteger(delaySeconds) || delaySeconds < 0 || delaySeconds > 60) {
    throw new Error('--delay must be an integer from 0 to 60 seconds.');
  }
  // Capture the original destination before queuing, even if Pi changes session.
  const ready = JSON.parse(readFileSync(join(directory, '.pi/notifications-ready.json'), 'utf8'));
  const destination = new URL(ready.url);
  if (destination.protocol !== 'http:' || destination.hostname !== '127.0.0.1' ||
      destination.username || destination.password || destination.pathname !== '/' ||
      destination.search || destination.hash || typeof ready.sessionId !== 'string' || !ready.sessionId.trim()) {
    throw new Error('Expected a loopback Pi ready file with a session ID.');
  }
  const runId = `local-ci-${randomUUID()}`;
  const runDirectory = join(directory, '.demo/runs', runId);
  const snapshot = join(runDirectory, 'snapshot');
  mkdirSync(snapshot, { recursive: true });
  const hash = createHash('sha256');
  for (const name of fixtureFiles) {
    const content = readFileSync(join(directory, name));
    writeFileSync(join(snapshot, name), content);
    hash.update(name + '\0').update(content).update('\0');
  }
  const revision = hash.digest('hex');
  const report = { runId, revision, sessionId: ready.sessionId, queuedAt: new Date().toISOString(),
    simulatedQueueSeconds: delaySeconds, snapshot, log: join(runDirectory, 'test.log') };
  json(join(runDirectory, 'result.json'), report);
  log(`Queued ${runId}; captured source and destination session. Simulated queue delay: ${delaySeconds}s.`);
  await delay(delaySeconds * 1000, undefined, { signal });
  let stdout = ''; let stderr = ''; let exitCode = 0;
  // A worker launched from node:test must start an independent test runner.
  const workerEnvironment = { ...process.env };
  delete workerEnvironment.NODE_TEST_CONTEXT;
  try {
    ({ stdout, stderr } = await execute(process.execPath, ['--test', '--test-reporter=tap', 'shipping.test.mjs'], {
      cwd: snapshot, env: workerEnvironment, timeout: 30000, maxBuffer: 1024 * 1024, signal,
    }));
  } catch (error) {
    if (!Number.isInteger(error.code) || error.killed) throw error;
    ({ stdout = '', stderr = '', code: exitCode } = error);
  }
  const conclusion = exitCode === 0 ? 'success' : 'failure';
  writeFileSync(report.log, stdout + stderr);
  Object.assign(report, { testedAt: new Date().toISOString(), exitCode, conclusion });
  json(join(runDirectory, 'result.json'), report);
  const failedTests = stdout.split('\n').filter(line => /^(?:not ok\b|✖ )/.test(line)).slice(0, 4).join('; ');
  const message = `runId=${runId}; revision=sha256:${revision}; conclusion=${conclusion}; ` +
    (failedTests ? `failedTests=${failedTests}; ` : '') +
    `testedSnapshot=${snapshot}; log=${report.log}. This result is for the captured shipping source; compare it with current files.`;
  const response = await fetch(new URL('/notify', destination), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: ready.sessionId, source: 'Local CI demo', message }),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000),
  });
  if (response.status !== 201) {
    throw new Error(`CI finished (${conclusion}) but delivery failed: HTTP ${response.status}. Log: ${report.log}`);
  }
  report.notification = await response.json();
  report.deliveredAt = new Date().toISOString();
  json(join(runDirectory, 'result.json'), report);
  log(`CI ${conclusion}; HTTP 201; notification ${report.notification.id}\nLog: ${report.log}`);
  return report;
}

export async function runDemoCI(directory, { signal, delaySeconds = 8, readyTimeoutMs = 15000 } = {}) {
  const log = message => appendFileSync(join(directory, '.demo/ci-console.log'), message + '\n');
  log('Waiting for the Pi notification receiver.');
  const deadline = Date.now() + readyTimeoutMs;
  try {
    for (;;) {
      signal?.throwIfAborted();
      let ready;
      try { ready = JSON.parse(readFileSync(join(directory, '.pi/notifications-ready.json'), 'utf8')); }
      catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
      if (ready?.url && ready?.sessionId) break;
      if (Date.now() >= deadline) throw new Error('Pi receiver did not become ready within the startup timeout.');
      await delay(25, undefined, { signal });
    }
    return await runCI(directory, { delaySeconds, signal, log });
  } catch (error) {
    log(signal?.aborted ? 'Demo CI cancelled because Pi exited.' : `Demo CI failed: ${error.message}`);
    throw error;
  }
}

async function main(args) {
  if (args[0] === 'setup' && args.length === 1) {
    console.log(prepareDemo());
  } else if (args[0] === 'ci' && (args.length === 2 || (args.length === 4 && args[2] === '--delay'))) {
    await runCI(args[1], { delaySeconds: args.length === 4 ? Number(args[3]) : 8 });
  } else if (args[0] === 'launch' && args.length === 1) {
    const directory = prepareDemo();
    console.log(`Demo workspace: ${directory}\n\nPi and local CI start automatically (8s simulated queue delay).\n` +
      `CI delivery log: ${join(directory, '.demo/ci-console.log')}\n` +
      'If Pi finishes before CI arrives, send: Continue with any relevant CI result received.\n\n' +
      `To run CI again in another terminal:\nnode ${quote(runner)} ci ${quote(directory)} --delay 0\n`);
    const { spawn } = await import('node:child_process');
    const controller = new AbortController();
    const child = spawn(process.env.PI_BINARY ?? 'pi', [
      '--no-extensions', '--no-skills', '--no-context-files', '--no-prompt-templates',
      '-e', join(root, 'src/pi-extension.ts'),
      'Read .demo/task.txt and carry out the task.',
    ], { cwd: directory, stdio: 'inherit', env: { ...process.env,
      PI_NOTIFY_DB: join(directory, '.pi/notifications.sqlite'), PI_NOTIFY_PORT: '0',
      PI_NOTIFY_READY: join(directory, '.pi/notifications-ready.json'),
      PI_NOTIFY_TRACE: join(directory, '.demo/runtime.jsonl'), PI_NOTIFY_PROVIDER_TRACE: '',
      PI_NOTIFY_PROMPT: join(root, 'prompts/v3.txt'), PI_NOTIFY_POSITION: 'tail',
      PI_NOTIFY_CONTEXT: '1', PI_NOTIFY_DISMISS: 'single', PI_NOTIFY_LAB: '0',
    } });
    const exited = new Promise(resolve => {
      child.on('error', error => { console.error(error.message); process.exitCode = 1; controller.abort(); resolve(); });
      child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); controller.abort(); resolve(); });
    });
    // Keep worker output out of Pi's terminal UI; preserve it in the demo log.
    const pendingCI = runDemoCI(directory, { signal: controller.signal })
      .then(report => ({ report }), error => ({ error }));
    await exited;
    const outcome = await pendingCI;
    if (outcome.report) console.log(`Demo CI ${outcome.report.conclusion}; HTTP 201; notification delivered.\n` +
      `Delivery log: ${join(directory, '.demo/ci-console.log')}`);
    else if (!controller.signal.aborted || outcome.error.name !== 'AbortError') {
      console.error(`Demo CI failed: ${outcome.error.message}`);
      process.exitCode = 1;
    }
  } else {
    throw new Error('Usage: node demo/ci.mjs launch | setup | ci <workspace> [--delay 0..60]');
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(runner)) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
