import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { scenario, SCENARIOS } from './scenarios.mjs';
import { assess } from './assess.mjs';
import { CONTEXT_TYPE } from '../src/store.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const arg = (name, fallback) => { const i = args.indexOf(`--${name}`); return i < 0 ? fallback : args[i + 1]; };
const version = arg('prompt', 'v1');
const repeats = Number(arg('repeat', '3'));
const names = arg('scenarios', SCENARIOS.join(',')).split(',');
const cases = arg('cases', null);
const concurrency = Number(arg('concurrency', '2'));
const campaign = arg('campaign', `${new Date().toISOString().replaceAll(':', '-')}-${version}`);
const output = resolve(root, 'artifacts', campaign);
const provider = arg('provider', 'openai');
const model = arg('model', 'gpt-6.1-sol');
const thinking = arg('thinking', 'medium');
const timeoutMs = Number(arg('timeout', '180000'));
if (!/^v\d+$/.test(version) || !Number.isInteger(repeats) || repeats < 1 || !Number.isInteger(concurrency) || concurrency < 1 || concurrency > 3) throw new Error('Invalid experiment arguments');
mkdirSync(output, { recursive: true });
const promptPath = join(root, 'prompts', `${version}.txt`);
if (!existsSync(promptPath)) throw new Error(`Missing prompt ${version}`);

const redact = value => String(value).replace(/sk-[a-zA-Z0-9_-]{8,}/g, '[REDACTED]').replace(/Bearer\s+[a-zA-Z0-9._-]+/gi, 'Bearer [REDACTED]');
const delay = ms => new Promise(r => setTimeout(r, ms));
const readLines = path => {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').filter(Boolean).flatMap(line => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
};
const allResults = [];

async function runOne(name, repetition) {
  const spec = scenario(name, repetition);
  const directory = join(output, `${name}-${repetition}`);
  if (existsSync(join(directory, 'summary.json'))) throw new Error(`Run already exists: ${directory}`);
  mkdirSync(directory, { recursive: true });
  const work = mkdtempSync(join(tmpdir(), 'pi-notification-work-'));
  const config = mkdtempSync(join(tmpdir(), 'pi-notification-config-'));
  const tracePath = join(directory, 'runtime.jsonl');
  const eventsPath = join(directory, 'events.jsonl');
  const readyPath = join(work, 'ready.json');
  const events = [];
  const received = [];
  const responses = new Map();
  const started = new Date().toISOString();
  const deadline = Date.now() + timeoutMs;
  let child; let exit; let request = 0; let url; let idleVerified = null;
  let result; let initialResult; let error; let historyText = ''; let transcriptBlockPersisted = null;
  const trace = () => readLines(tracePath);
  const wait = async (check, label) => {
    while (Date.now() < deadline) {
      const value = check(); if (value) return value;
      if (exit !== undefined) throw new Error(`Pi exited (${exit}) while waiting for ${label}`);
      const failure = events.find(e => e.type === 'message_end' && e.message?.role === 'assistant' && e.message?.stopReason === 'error');
      if (failure) throw new Error(failure.message.errorMessage ?? 'Provider error');
      await delay(40);
    }
    throw new Error(`Timeout waiting for ${label}`);
  };
  const command = async body => {
    const id = `request-${++request}`;
    child.stdin.write(JSON.stringify({ id, ...body }) + '\n');
    const response = await wait(() => responses.get(id), body.type);
    if (!response.success) throw new Error(response.error ?? `${body.type} failed`);
    return response;
  };
  const prompt = async message => {
    const before = events.filter(e => e.type === 'agent_settled').length;
    await command({ type: 'prompt', message });
    await wait(() => events.filter(e => e.type === 'agent_settled').length > before, 'agent settled');
    const failure = events.filter(e => e.type === 'message_end' && e.message?.role === 'assistant' && e.message?.stopReason === 'error').at(-1);
    if (failure) throw new Error(failure.message.errorMessage ?? 'Provider error');
  };
  const post = async (path, body) => {
    const response = await fetch(url + path, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    return response.json();
  };
  const notify = async () => {
    for (const notification of spec.notifications) received.push(await post('/notify', notification));
  };
  const readResult = () => existsSync(join(work, 'result.json')) ? JSON.parse(readFileSync(join(work, 'result.json'), 'utf8')) : undefined;
  try {
    // Only the selected provider's credential is copied to a private temporary config.
    // It is never serialized into artifacts, stdout, or environment variables.
    const authPath = join(homedir(), '.pi', 'agent', 'auth.json');
    const auth = existsSync(authPath) ? JSON.parse(readFileSync(authPath, 'utf8')) : {};
    if (auth[provider]) writeFileSync(join(config, 'auth.json'), JSON.stringify({ [provider]: auth[provider] }), { mode: 0o600 });
    else if (!process.env.OPENAI_API_KEY || provider !== 'openai') throw new Error(`No existing credential for ${provider}`);
    writeFileSync(join(config, 'settings.json'), JSON.stringify({ defaultProvider: provider, defaultModel: model, defaultThinkingLevel: thinking,
      enableMcp: false, packages: [] }));
    writeFileSync(join(directory, 'spec.json'), JSON.stringify({ ...spec, prompt: version, provider, model, thinking }, null, 2));
    child = spawn(process.env.PI_BINARY ?? 'pi', [
      '--mode', 'rpc', '--no-session', '--offline', '--no-extensions', '--no-skills',
      '--no-prompt-templates', '--no-context-files', '--no-themes', '--no-approve',
      '--provider', provider, '--model', model, '--thinking', thinking,
      '--tools', 'lab_step,lab_submit,notifications_dismiss,notifications_history',
      '-e', join(root, 'src', 'pi-extension.ts'), '-e', join(root, 'experiments', 'fixture.ts'),
    ], { cwd: work, env: { ...process.env, PI_CODING_AGENT_DIR: config, PI_OFFLINE: '1', PI_TELEMETRY: '0',
      PI_NOTIFY_TRACE: tracePath, PI_NOTIFY_PROVIDER_TRACE: join(directory, 'provider.jsonl'),
      PI_NOTIFY_READY: readyPath, PI_NOTIFY_DB: join(directory, 'notifications.sqlite'),
      PI_NOTIFY_PROMPT: promptPath, PI_NOTIFY_LAB: '1', PI_LAB_GATES: JSON.stringify(spec.gates) },
      stdio: ['pipe', 'pipe', 'pipe'] });
    let buffer = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      buffer += chunk;
      let i;
      while ((i = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, i).replace(/\r$/, ''); buffer = buffer.slice(i + 1);
        try {
          const event = JSON.parse(line);
          if (event.type === 'message_update') continue; // Final messages carry the observable output.
          if (event.message?.content) event.message.content = event.message.content.filter(c => c.type !== 'thinking');
          events.push(event);
          appendFileSync(eventsPath, redact(JSON.stringify(event)) + '\n');
          if (event.type === 'response') responses.set(event.id, event);
        } catch { appendFileSync(join(directory, 'stderr.log'), redact(line) + '\n'); }
      }
    });
    child.stderr.on('data', chunk => appendFileSync(join(directory, 'stderr.log'), redact(chunk)));
    child.once('error', e => { error = redact(e.message); exit = -1; });
    child.once('exit', code => { exit = code ?? -1; });
    await wait(() => existsSync(readyPath), 'notification endpoint');
    url = JSON.parse(readFileSync(readyPath, 'utf8')).url;
    if (spec.timing === 'idle') {
      await prompt(spec.task);
      initialResult = readResult();
      const before = trace().filter(e => e.type === 'provider_request').length;
      await notify();
      await delay(1000);
      idleVerified = trace().filter(e => e.type === 'provider_request').length === before;
      await prompt('Review the deployment plan for the same task using the information now available and save an updated plan. The three source snapshots have already been read.');
    } else {
      const running = prompt(spec.task);
      // Attach a rejection handler while separately orchestrating the gate.
      running.catch(() => {});
      if (spec.timing === 'in-flight') await wait(() => trace().find(e => e.type === 'provider_response' && e.call === 1 && e.status < 400), 'in-flight provider response');
      else await wait(() => trace().find(e => e.type === 'lab_gate' && e.stage === 1), 'first source read');
      await notify();
      await wait(() => trace().find(e => e.type === 'lab_gate' && e.stage === 1), 'first source gate');
      await post('/lab/release', { stage: 1 });
      await running;
    }
    result = readResult();
    if (!result) throw new Error('Agent did not save a deployment plan');
    if (spec.historyFollowup) {
      const offset = events.length;
      await prompt('For this test, dismiss every notification still active using notifications_dismiss. Then use notifications_history to retrieve the dismissed validation result and report its maxBatch and release note reference. Do not change result.json.');
      historyText = events.slice(offset).filter(e => e.type === 'message_end' && e.message?.role === 'assistant')
        .flatMap(e => e.message.content ?? []).filter(c => c.type === 'text').map(c => c.text).join('\n');
    }
    const transcript = await command({ type: 'get_messages' });
    transcriptBlockPersisted = transcript.data.messages.some(m => m.role === 'custom' && m.customType === CONTEXT_TYPE);
    if (transcriptBlockPersisted) throw new Error('The request-local notification block persisted in the transcript');
  } catch (e) { error = redact(e.message); }
  finally {
    if (child && exit === undefined) {
      child.stdin.end();
      await Promise.race([new Promise(r => child.once('exit', r)), delay(3000)]);
      if (exit === undefined) child.kill('SIGTERM');
      await Promise.race([new Promise(r => child.once('exit', r)), delay(1000)]);
      if (exit === undefined) child.kill('SIGKILL');
    }
    rmSync(config, { recursive: true, force: true });
    rmSync(work, { recursive: true, force: true });
  }
  const assistantText = events.filter(e => e.type === 'message_end' && e.message?.role === 'assistant')
    .flatMap(e => e.message.content ?? []).filter(c => c.type === 'text').map(c => c.text).join('\n');
  const summary = { name, repetition, prompt: version, provider, model, thinking, started,
    finished: new Date().toISOString(), notifications: received, result, initialResult, idleVerified,
    historyText, assistantText, transcriptBlockPersisted, error: error ?? null,
    assessment: assess({ spec, result, error, trace: trace(), received, idleVerified, historyText, providerRecords: readLines(join(directory, 'provider.jsonl')) }) };
  writeFileSync(join(directory, 'summary.json'), JSON.stringify(summary, null, 2));
  allResults.push(summary);
  writeFileSync(join(output, 'summary.json'), JSON.stringify({ campaign, prompt: version, provider, model, thinking, results: allResults }, null, 2));
  console.log(`${version} ${name} #${repetition}: ${error ? 'ERROR ' + error : `behavior=${summary.assessment.behaviorPass} injection=${summary.assessment.injectionPass}`}`);
  return summary;
}

const jobs = cases ? cases.split(',').map(item => {
  const [name, repetition] = item.split(':');
  if (!SCENARIOS.includes(name) || !/^[1-9]\d*$/.test(repetition)) throw new Error(`Invalid case: ${item}`);
  return { name, repetition: Number(repetition) };
}) : names.flatMap(name => Array.from({ length: repeats }, (_, i) => ({ name, repetition: i + 1 })));
let index = 0;
await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, async () => {
  while (index < jobs.length) { const job = jobs[index++]; await runOne(job.name, job.repetition); }
}));
console.log(`Artifacts: ${output}`);
if (allResults.some(r => r.error)) process.exitCode = 1;
