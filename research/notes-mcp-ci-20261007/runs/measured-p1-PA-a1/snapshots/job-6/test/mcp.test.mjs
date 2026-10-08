import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { fixture, launch } from './helpers.mjs';
import { openStore } from '../src/store.mjs';

test('real stdio MCP: all tools, resources, errors, notifications and restart', async t => {
  const db = fixture(t), proc = launch(t, 'src/mcp.mjs', ['--db', db]);
  let id = 0;
  const rpc = async (method, params) => {
    const requestId = ++id;
    proc.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }) + '\n');
    const response = await proc.next(); assert.equal(response.id, requestId); return response;
  };
  const tool = async (name, args = {}) => {
    const response = await rpc('tools/call', { name, arguments: args });
    assert.ok(!response.error); assert.ok(!response.result.isError);
    return JSON.parse(response.result.content[0].text);
  };
  proc.child.stdin.write('\n{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
  assert.equal((await rpc('initialize', {})).result.protocolVersion, '2024-11-05');
  assert.deepEqual((await rpc('ping')).result, {});
  const tools = (await rpc('tools/list')).result.tools;
  assert.equal(tools.length, 8);
  assert.ok(tools.every(tool => tool.inputSchema.type === 'object'));
  const a = await tool('notes_create', { text: '  hello  ', tags: ['Work'] });
  assert.equal(a.text, 'hello');
  assert.deepEqual(await tool('notes_get', { id: a.id }), a);
  const b = await tool('notes_update', { id: a.id, tags: ['NEW'] });
  assert.deepEqual(b.tags, ['new']);
  assert.deepEqual(await tool('notes_list', { tag: ' NEW ' }), [b]);
  assert.deepEqual(await tool('tags_list'), [{ name: 'new', count: 1 }]);
  const imported = await tool('notes_import', { notes: [{ text: 'next' }, { text: 'last', tags: ['ok'] }] });
  assert.equal(imported.length, 2);
  assert.deepEqual(await tool('notes_export'), { version: 1, notes: [{ text: 'hello', tags: ['new'] }, { text: 'next', tags: [] }, { text: 'last', tags: ['ok'] }] });
  assert.equal((await rpc('resources/list')).result.resources[0].uri, 'notes://all');
  assert.deepEqual(JSON.parse((await rpc('resources/read', { uri: 'notes://all' })).result.contents[0].text), [imported[1], imported[0], b]);
  assert.equal((await rpc('resources/read', { uri: 'notes://missing' })).error.code, -32002);
  assert.equal((await rpc('unsupported')).error.code, -32601);
  for (const args of [{ name: 'notes_import', arguments: { notes: [{ text: 'would leak' }, { text: 'invalid tags', tags: [42] }] } }, { name: 'notes_create', arguments: { text: '' } }, { name: 'notes_get', arguments: { id: '1' } }, { name: 'unknown' }]) {
    assert.equal((await rpc('tools/call', args)).result.isError, true);
  }
  assert.equal((await tool('notes_list')).length, 3);
  proc.child.stdin.write('not JSON\n'); assert.equal((await proc.next()).error.code, -32700);
  assert.equal(await tool('notes_delete', { id: a.id }), true);
  assert.equal(await tool('notes_delete', { id: a.id }), false);
  assert.equal(await tool('notes_get', { id: a.id }), null);
  assert.equal(await tool('notes_update', { id: a.id, text: 'missing' }), null);
  const exit = once(proc.child, 'exit'); proc.child.stdin.end();
  const [code] = await exit; assert.equal(code, 0);
  const store = openStore(db); try { assert.equal(store.listNotes().length, 2); } finally { store.close(); }
});
