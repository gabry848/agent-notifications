import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { once } from 'node:events';

const rpc = (id, method, params) => ({ jsonrpc: '2.0', ...(id === undefined ? {} : { id }), method, params });
const call = (id, name, args = {}) => rpc(id, 'tools/call', { name, arguments: args });
function mcp(db, requests) {
  const child = spawnSync(process.execPath, ['src/mcp.mjs', '--db', db], {
    input: '\n' + requests.map(r => typeof r === 'string' ? r : JSON.stringify(r)).join('\n') + '\n', encoding: 'utf8', timeout: 10000
  });
  assert.equal(child.status, 0, child.stderr);
  return child.stdout.trim().split('\n').map(JSON.parse);
}
const value = response => JSON.parse(response.result.content[0].text);

test('real MCP stdio: tools, resources, notifications, errors, and bulk atomicity', () => {
  const responses = mcp(':memory:', [
    rpc('init', 'initialize', {}), rpc(undefined, 'notifications/initialized'), rpc(1, 'ping'), rpc(2, 'tools/list'),
    call(3, 'notes_create', { text: '  First  ', tags: [' Work '] }), call(4, 'notes_get', { id: 1 }),
    call(5, 'notes_update', { id: 1, text: 'Changed' }), call(6, 'notes_list'), call(7, 'tags_list'),
    call(8, 'notes_import', { notes: [{ text: 'valid' }, { text: 'bad', tags: [3] }] }),
    call(9, 'notes_import', { notes: [{ text: 'valid' }, { text: '' }] }),
    call(10, 'notes_import', { notes: Array.from({ length: 105 }, (_, i) => ({ text: `extra ${i}` })) }),
    call(11, 'notes_export'), rpc(12, 'resources/list'), rpc(13, 'resources/read', { uri: 'notes://all' }),
    rpc(14, 'resources/read', { uri: 'bad' }), rpc(15, 'unknown'), call(16, 'notes_get', { id: '1' }),
    call(17, 'notes_delete', { id: 1 }), call(18, 'notes_get', { id: 1 }), '{bad'
  ]);
  const byId = new Map(responses.map(r => [r.id, r]));
  assert.equal(responses.length, 20);
  assert.equal(byId.get('init').result.protocolVersion, '2024-11-05');
  assert.equal(byId.get(2).result.tools.length, 8);
  assert.equal(value(byId.get(3)).text, 'First');
  assert.deepEqual(value(byId.get(4)), value(byId.get(3)));
  assert.equal(value(byId.get(5)).text, 'Changed');
  assert.equal(value(byId.get(6)).length, 1);
  assert.deepEqual(value(byId.get(7)), [{ name: 'work', count: 1 }]);
  assert.ok(byId.get(8).result.isError && byId.get(9).result.isError);
  assert.equal(value(byId.get(10)).length, 105);
  const exported = value(byId.get(11));
  assert.equal(exported.notes.length, 106);
  assert.deepEqual(exported.notes[0], { text: 'Changed', tags: ['work'] });
  const resource = JSON.parse(byId.get(13).result.contents[0].text);
  assert.equal(resource.length, 106);
  assert.equal(resource[0].text, 'extra 104');
  assert.ok(resource[0].createdAt && resource[0].id);
  assert.equal(byId.get(14).error.code, -32002);
  assert.equal(byId.get(15).error.code, -32601);
  assert.ok(byId.get(16).result.isError);
  assert.equal(value(byId.get(17)), true);
  assert.equal(value(byId.get(18)), null);
  assert.equal(byId.get(null).error.code, -32700);
});

test('web dashboard and JSON API, with shared MCP persistence', { timeout: 20000 }, async () => {
  const dir = mkdtempSync(join('test', '.services-'));
  const db = join(dir, 'notes.sqlite');
  mcp(db, [call(1, 'notes_create', { text: 'from MCP', tags: ['shared'] })]);
  const child = spawn(process.execPath, ['src/web.mjs', '--db', db, '--port', '0'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = ''; child.stderr.on('data', c => { stderr += c; });
  const lines = createInterface({ input: child.stdout });
  try {
    const [line] = await once(lines, 'line', { signal: AbortSignal.timeout(5000) });
    const base = `http://127.0.0.1:${JSON.parse(line).port}`;
    const request = (path, method = 'GET', data) => fetch(base + path, { method, redirect: 'manual', ...(data === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }) });
    assert.equal((await (await request('/api/notes')).json())[0].text, 'from MCP');
    const dangerous = '<script>alert("x")</script>&';
    const created = await (await request('/api/notes', 'POST', { text: dangerous, tags: ['<b>'] })).json();
    let html = await (await request('/')).text();
    assert.ok(html.includes('&lt;script&gt;') && html.includes('&lt;b&gt;'));
    assert.ok(!html.includes(dangerous));
    html = await (await request('/?q=' + encodeURIComponent(dangerous))).text();
    assert.ok(!html.includes(dangerous));
    assert.equal((await request(`/notes/${created.id}/edit`)).status, 200);
    assert.equal((await request('/api/notes', 'POST', { text: ' ' })).status, 400);
    assert.equal((await request(`/api/notes/${created.id}`, 'PATCH', { text: 'Changed', tags: [null] })).status, 400);
    assert.equal((await (await request(`/api/notes/${created.id}`)).json()).text, dangerous);
    assert.equal((await request('/api/import', 'POST', { notes: [{ text: 'earlier' }, { text: 'later', tags: [''] }] })).status, 400);
    assert.equal((await request('/api/import', 'POST', { notes: [{ text: 'earlier' }, { text: '' }] })).status, 400);
    assert.equal((await (await request('/api/notes')).json()).length, 2);
    const imported = await request('/api/import', 'POST', { notes: Array.from({ length: 24 }, (_, i) => ({ text: `page ${i}`, tags: ['pages'] })) });
    assert.equal((await imported.json()).length, 24);
    html = await (await request('/?tag=pages&page=2')).text();
    assert.ok(html.includes('page 0') && !html.includes('<pre>page 4</pre>'));
    assert.ok(html.includes('Previous') && html.includes('pages (24)'));
    assert.equal((await (await request('/api/notes?tag=+PAGES+&limit=1&offset=1')).json())[0].text, 'page 22');
    assert.equal((await request('/api/notes?limit=0')).status, 400);
    const form = async (path, text, tags) => fetch(base + path, { method: 'POST', redirect: 'manual', body: new URLSearchParams({ text, tags }) });
    assert.equal((await form('/notes', 'new form', 'Home, HOME')).status, 303);
    const note = (await (await request('/api/notes')).json())[0];
    assert.deepEqual(note.tags, ['home']);
    assert.equal((await form(`/notes/${note.id}`, 'edited form', 'other')).headers.get('location'), '/');
    assert.equal((await form(`/notes/${note.id}`, '', '')).status, 400);
    assert.equal((await request(`/notes/${note.id}/delete`, 'POST')).status, 303);
    assert.equal((await request(`/api/notes/${note.id}`)).status, 404);
    assert.equal((await request('/api/notes/99999', 'DELETE')).status, 404);
    assert.equal((await request('/missing')).status, 404);
    assert.equal((await request(`/api/notes/${created.id}`, 'DELETE')).status, 200);
    assert.ok(!(await (await request('/api/tags')).json()).some(t => t.name === '<b>'));
    const exported = await (await request('/api/export')).json();
    assert.equal(exported.version, 1);
    assert.equal(exported.notes[0].text, 'from MCP');
  } finally {
    lines.close();
    const exited = once(child, 'exit'); child.kill('SIGTERM');
    await exited;
    rmSync(dir, { recursive: true, force: true });
  }
  assert.ok(!stderr.includes('Error:'), stderr);
});
