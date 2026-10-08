import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdtemp, readFile, writeFile, readdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createCatalog} from '../src/catalog.mjs';
import {createServer} from '../src/server.mjs';
import {exportCSV} from '../src/transfer.mjs';

const record = (id, extra = {}) => ({id, name: id, version: '1.0.0', tags: [], dependencies: [], ...extra});

test('HTTP integrates CRUD, search, graph and atomic transfers; errors leave server usable', async t => {
  const catalog = createCatalog();
  const server = createServer(catalog);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, method = 'GET', body) => fetch(base + path, {method, body});
  assert.deepEqual(await (await request('/health')).json(), {ok: true});
  const a = record('a/b', {name: 'Café', tags: [' WEB ']});
  assert.equal((await request('/records', 'POST', JSON.stringify(a))).status, 201);
  assert.equal((await request('/records', 'POST', JSON.stringify(a))).status, 409);
  assert.equal((await request('/records/a%2Fb')).status, 200);
  const patched = await request('/records/a%2Fb', 'PATCH', '{"name":"Updated"}');
  assert.equal((await patched.json()).name, 'Updated');
  assert.equal((await (await request('/records?text=updated&tags=web')).json()).total, 1);
  assert.equal((await request('/records?limit=1.5')).status, 400);
  assert.equal((await request('/records', 'POST', '{bad')).status, 400);
  assert.equal((await request('/records/a%2Fb', 'PATCH', '{"id":"other"}')).status, 400);
  assert.equal((await request('/records/missing')).status, 404);
  assert.equal((await request('/records/%ZZ')).status, 400);
  const b = record('b', {dependencies: ['a/b']});
  assert.deepEqual(await (await request('/import.csv', 'POST', exportCSV([b]))).json(), {added: 1});
  assert.deepEqual(await (await request('/plan?ids=b')).json(), {ids: ['a/b', 'b']});
  const csv = await request('/export.csv'); assert.match(csv.headers.get('content-type'), /text\/csv/);
  const ndjson = await request('/export.ndjson'); assert.match(ndjson.headers.get('content-type'), /application\/x-ndjson/);
  assert.equal((await ndjson.text()).trim().split('\n').length, 2);
  const before = catalog.list();
  assert.equal((await request('/import.ndjson', 'POST', JSON.stringify(record('c')) + '\n{broken}')).status, 400);
  assert.equal((await request('/import.csv', 'POST', exportCSV([record('c'), record('b')]))).status, 409);
  assert.equal((await request('/records', 'POST', 'x'.repeat(1024 * 1024 + 1))).status, 413);
  assert.deepEqual(catalog.list(), before);
  assert.equal((await request('/import.ndjson', 'POST', JSON.stringify(record('c', {name: '世界'})))).status, 201);
  assert.equal((await request('/records/c', 'DELETE')).status, 204);
  assert.equal((await request('/records/c', 'DELETE')).status, 404);
  assert.equal((await request('/unknown')).status, 404);
  assert.equal((await request('/health')).status, 200);
});

test('CLI validates before atomic persistence and interoperates with CSV', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'catalog-test-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const file = join(dir, 'catalog.json'), input = join(dir, 'input.csv');
  const cli = (...args) => spawnSync(process.execPath, [resolve('src/cli.mjs'), ...args], {encoding: 'utf8'});
  assert.notEqual(cli('list').status, 0);
  const initial = cli('list', '--file', file);
  assert.equal(initial.status, 0); assert.equal(JSON.parse(initial.stdout).total, 0);
  assert.equal(cli('add', '--file', file, '--record', JSON.stringify(record('a', {tags: ['WEB']}))).status, 0);
  const before = await readFile(file, 'utf8');
  for (const args of [['add', '--record', '{bad'], ['add', '--record', JSON.stringify(record('a'))], ['plan', '--ids', 'missing'], ['list', '--unknown', 'x']]) {
    const result = cli(args[0], '--file', file, ...args.slice(1));
    assert.notEqual(result.status, 0); assert.ok(result.stderr); assert.equal(await readFile(file, 'utf8'), before);
  }
  await writeFile(input, exportCSV([record('b', {dependencies: ['a']})]));
  assert.equal(cli('import-csv', '--file', file, '--input', input).status, 0);
  assert.deepEqual(JSON.parse(cli('plan', '--file', file, '--ids', 'b').stdout), {ids: ['a', 'b']});
  assert.equal(JSON.parse(cli('list', '--file', file, '--tags', 'web').stdout).total, 1);
  assert.match(cli('export-csv', '--file', file).stdout, /^id,name,version,tags,dependencies/);
  assert.equal(cli('remove', '--file', file, '--id', 'b').status, 0);
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')).map(r => r.id), ['a']);
  assert.deepEqual((await readdir(dir)).sort(), ['catalog.json', 'input.csv']);
  await writeFile(file, '[{"invalid":true}]');
  assert.notEqual(cli('remove', '--file', file, '--id', 'a').status, 0);
  assert.equal(await readFile(file, 'utf8'), '[{"invalid":true}]');
});
