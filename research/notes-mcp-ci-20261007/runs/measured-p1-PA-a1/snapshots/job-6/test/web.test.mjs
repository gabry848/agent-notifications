import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, launch } from './helpers.mjs';

test('HTTP API, atomic import, escaped dashboard, edit/create/delete and pagination', async t => {
  const proc = launch(t, 'src/web.mjs', ['--db', fixture(t), '--port', '0']);
  const { port } = await proc.next(); assert.ok(port > 0);
  const request = (path, options) => fetch(`http://127.0.0.1:${port}${path}`, options);
  const json = (method, data) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  const form = data => ({ method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(data), redirect: 'manual' });
  const text = '<script>alert("x")</script> & %_';
  const created = await request('/api/notes', json('POST', { text, tags: ['<TAG>', 'Work'] }));
  assert.equal(created.status, 201); const a = await created.json();
  assert.deepEqual(await (await request(`/api/notes/${a.id}`)).json(), a);
  assert.deepEqual(await (await request('/api/notes?q=%25_&tag=WORK')).json(), [a]);
  let html = await (await request('/?q=%3Cscript%3E')).text();
  assert.ok(!html.includes('<script>')); assert.ok(html.includes('&lt;script&gt;')); assert.ok(html.includes('&lt;tag&gt;'));
  assert.match(html, /name="q" value="&lt;script&gt;"/);
  html = await (await request(`/notes/${a.id}/edit`)).text(); assert.ok(html.includes('&lt;script&gt;'));
  const before = await (await request('/api/export')).json();
  for (const records of [[{ text: 'first' }, { text: 'bad', tags: ['ok', null] }], [{ text: 'first' }, { text: ' ' }]]) {
    const response = await request('/api/import', json('POST', { notes: records }));
    assert.equal(response.status, 400); assert.deepEqual(await (await request('/api/export')).json(), before);
  }
  assert.equal((await request('/api/notes', json('POST', { text: '' }))).status, 400);
  assert.equal((await request(`/api/notes/${a.id}`, json('PATCH', { text: 'changed', tags: [false] }))).status, 400);
  assert.deepEqual(await (await request(`/api/notes/${a.id}`)).json(), a);
  assert.equal((await request('/api/notes?limit=101')).status, 400);
  assert.equal((await request('/?page=0')).status, 400);
  assert.equal((await request('/api/notes/99999')).status, 404);
  assert.equal((await request('/not-found')).status, 404);
  const formError = await request('/notes', form({ text: '', tags: '' }));
  assert.equal(formError.status, 400); assert.match(await formError.text(), /class="error"/);
  const update = await request(`/notes/${a.id}`, form({ text: 'edited', tags: 'HOME,home' }));
  assert.equal(update.status, 303); assert.equal(update.headers.get('location'), '/');
  assert.deepEqual((await (await request(`/api/notes/${a.id}`)).json()).tags, ['home']);
  const creation = await request('/notes', form({ text: 'form created', tags: '' })); assert.equal(creation.status, 303);
  const imported = await (await request('/api/import', json('POST', { notes: Array.from({ length: 21 }, (_, i) => ({ text: `page note ${i}`, tags: ['page'] })) }))).json();
  assert.equal(imported.length, 21);
  html = await (await request('/?tag=page')).text(); assert.equal((html.match(/<article>/g) ?? []).length, 20); assert.match(html, /Next/); assert.match(html, /page \(21\)/);
  html = await (await request('/?tag=page&page=2')).text(); assert.equal((html.match(/<article>/g) ?? []).length, 1); assert.match(html, /Previous/);
  assert.deepEqual(await (await request('/api/notes?tag=page&limit=1&offset=20')).json(), [imported[0]]);
  assert.ok((await (await request('/api/tags')).json()).some(tag => tag.name === 'page' && tag.count === 21));
  const patched = await (await request(`/api/notes/${a.id}`, json('PATCH', { text: 'API edit', tags: [] }))).json(); assert.equal(patched.text, 'API edit');
  const deletion = await request(`/api/notes/${a.id}`, { method: 'DELETE' }); assert.equal(deletion.status, 200); assert.equal(await deletion.json(), true);
  assert.equal((await request(`/api/notes/${a.id}`, { method: 'DELETE' })).status, 404);
  assert.equal((await request(`/notes/${imported[0].id}/delete`, form({}))).status, 303);
  assert.equal((await request(`/notes/${imported[0].id}/edit`)).status, 404);
});
