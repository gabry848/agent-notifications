import { mkdtempSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { once } from 'node:events';

export function fixture(t) {
  const dir = mkdtempSync(resolve('test/.tmp-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, 'nested/notes.sqlite');
}
export function launch(t, script, args) {
  const child = spawn(process.execPath, [script, ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', chunk => stderr += chunk);
  const lines = [], waiters = [];
  const reader = createInterface({ input: child.stdout });
  reader.on('line', line => {
    if (waiters.length) waiters.shift().resolve(JSON.parse(line));
    else lines.push(JSON.parse(line));
  });
  child.on('exit', () => {
    for (const w of waiters.splice(0)) w.reject(new Error(`Process exited: ${stderr}`));
  });
  const next = () => lines.length ? Promise.resolve(lines.shift()) : new Promise((resolve, reject) => {
    const entry = { resolve: v => { clearTimeout(timer); resolve(v); }, reject: e => { clearTimeout(timer); reject(e); } };
    const timer = setTimeout(() => { const i = waiters.indexOf(entry); if (i >= 0) waiters.splice(i, 1); reject(new Error(`Output timeout: ${stderr}`)); }, 5000);
    waiters.push(entry);
  });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; }
    reader.close();
  });
  return { child, next, lines };
}
