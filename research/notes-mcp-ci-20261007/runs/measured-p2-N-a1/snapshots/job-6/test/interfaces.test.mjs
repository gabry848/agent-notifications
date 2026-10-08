import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';

function rpc(db, messages) {
  const result = spawnSync(process.execPath, ['src/mcp.mjs', '--db', db], {
    input: '\n' + messages.map(m => typeof m === 'string' ? m : JSON.stringify({ jsonrpc: '2.0', ...m })).join('\n') + '\n', encoding: 'utf8', timeout: 5000
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim().split('\n').map(JSON.parse);
}

test('real MCP transport, protocol errors, notifications and import atomicity', () => {
  const messages = rpc(':memory:', [
    { id: 'init', method: 'initialize' },
    { method: 'notifications/initialized' },
    { id: 2, method: 'tools/list' },
    { id: 3, method: 'tools/call', params: { name: 'notes_create', arguments: { text: ' first ', tags: ['A'] } } },
    { id: 4, method: 'tools/call', params: { name: 'notes_import', arguments: { notes: [{ text: 'valid' }, { text: 'bad', tags: [''] }] } } },
    { id: 5, method: 'resources/read', params: { uri: 'notes://all' } },
    { id: 6, method: 'resources/read', params: { uri: 'unknown' } },
    { id: 7, method: 'unknown' },
    '{broken',
    { id: 8, method: 'ping' }
  ]);
  assert.equal(messages.length, 9);
  assert.equal(messages[0].result.protocolVersion, '2024-11-05');
  assert.equal(messages[1].result.tools.length, 8);
  const note = JSON.parse(messages[2].result.content[0].text);
  assert.equal(note.text, 'first');
  assert.deepEqual(note.tags, ['a']);
  assert.equal(messages[3].result.isError, true);
  assert.deepEqual(JSON.parse(messages[4].result.contents[0].text), [note]);
  assert.equal(messages[5].error.code, -32002);
  assert.equal(messages[6].error.code, -32601);
  assert.equal(messages[7].error.code, -32700);
  assert.deepEqual(messages[8].result, {});
});

test('web dashboard and JSON API share durable state with MCP', { timeout: 15000 }, async () => {
  const dir = mkdtempSync(join(process.cwd(), '.test-interfaces-'));
  const db = join(dir, 'notes.sqlite');
  rpc(db, [{ id: 1, method: 'tools/call', params: { name: 'notes_create', arguments: { text: '<script>bad & "quoted"</script>', tags: ['<tag>'] } } }]);
  const child = spawn(process.execPath, ['src/web.mjs', '--db', db, '--port', '0'], { stdio: ['ignore', 'pipe', 'pipe'] });
  const closed = once(child, 'exit');
  const lines = createInterface({ input: child.stdout });
  try {
    const [line] = await once(lines, 'line');
    const base = `http://127.0.0.1:${JSON.parse(line).port}`;
    const request = (path, method = 'GET', data) => fetch(base + path, { method, ...(data === undefined ? {} : { body: JSON.stringify(data), headers: { 'Content-Type': 'application/json' } }) });
    const initial = await (await request('/api/notes')).json();
    assert.equal(initial.length, 1);
    const html = await (await request('/')).text();
    assert.ok(html.includes('&lt;script&gt;'));
    assert.ok(html.includes('&lt;tag&gt;'));
    assert.ok(!html.includes('<script>'));
    assert.ok((await (await request('/notes/1/edit')).text()).includes('&lt;script&gt;'));
    assert.equal((await request('/api/import', 'POST', { notes: [{ text: 'good' }, { text: 'bad', tags: null }] })).status, 400);
    assert.equal((await (await request('/api/notes')).json()).length, 1);
    const created = await (await request('/api/notes', 'POST', { text: ' second ', tags: ['WORK'] })).json();
    assert.equal(created.text, 'second');
    assert.deepEqual(created.tags, ['work']);
    const patched = await (await request(`/api/notes/${created.id}`, 'PATCH', { tags: ['home'] })).json();
    assert.deepEqual(patched.tags, ['home']);
    assert.equal((await request('/api/notes?limit=0')).status, 400);
    assert.equal((await request('/api/notes/999')).status, 404);
    assert.equal((await request('/missing')).status, 404);
    const form = await fetch(base + '/notes', { method: 'POST', body: new URLSearchParams({ text: 'form note', tags: ' One, TWO ' }), redirect: 'manual' });
    assert.equal(form.status, 303);
    assert.equal(form.headers.get('location'), '/');
    const failedForm = await fetch(base + '/notes', { method: 'POST', body: new URLSearchParams({ text: ' ' }) });
    assert.equal(failedForm.status, 400);
    assert.ok((await failedForm.text()).includes('role="alert"'));
    const records = await (await request('/api/import', 'POST', { notes: Array.from({ length: 23 }, (_, i) => ({ text: `page ${i}`, tags: ['page'] })) })).json();
    assert.equal(records.length, 23);
    const page = await (await request('/?tag=page&page=2')).text();
    assert.ok(page.includes('page 0'));
    assert.ok(!page.includes('page 22'));
    assert.ok(page.includes('Previous'));
    const exported = await (await request('/api/export')).json();
    assert.equal(exported.notes.length, 26);
    assert.equal(exported.notes[0].text, initial[0].text);
    assert.equal(await (await request(`/api/notes/${created.id}`, 'DELETE')).json(), true);
    assert.equal((await request(`/api/notes/${created.id}`, 'DELETE')).status, 404);
    assert.ok(!(await (await request('/api/tags')).json()).some(t => t.name === 'home'));
  } finally {
    lines.close(); child.kill('SIGTERM'); await closed;
    rmSync(dir, { recursive: true, force: true });
  }
});
