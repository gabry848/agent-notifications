import { createServer } from 'node:http';
import { parseArgs } from 'node:util';
import { openStore } from './store.mjs';
import { importNotes } from './import.mjs';
import { exportNotes } from './service.mjs';
import { validateObject } from './validation.mjs';

const { values } = parseArgs({ options: { db: { type: 'string', default: 'data/notes.sqlite' }, port: { type: 'string', default: '8080' } } });
const port = Number(values.port);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid port');
const store = openStore(values.db);
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const layout = body => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Quick Notes</title><style>
body{font:16px system-ui;max-width:850px;margin:2rem auto;padding:0 1rem;background:#f5f7fa;color:#182331}article,section{background:white;padding:1rem;margin:1rem 0;border-radius:8px}textarea{width:100%;box-sizing:border-box;min-height:100px}input,button,textarea{font:inherit;padding:.4rem}label{display:block;margin:.5rem 0}a{color:#135cb5}.text{white-space:pre-wrap;overflow-wrap:anywhere}.tags{color:#526477}.error{color:#a11}nav{display:flex;gap:1rem}form.inline{display:inline}</style></head><body><h1><a href="/">Quick Notes</a></h1>${body}</body></html>`;
const noteForm = (note = {}, error = '') => `<section><h2>${note.id ? 'Edit note' : 'Create note'}</h2>${error ? `<p class="error" role="alert">${escape(error)}</p>` : ''}<form method="post" action="${note.id ? `/notes/${note.id}` : '/notes'}"><label>Text<textarea name="text" required maxlength="4000">${escape(note.text ?? '')}</textarea></label><label>Tags (comma separated)<input name="tags" value="${escape(Array.isArray(note.tags) ? note.tags.join(', ') : note.tags ?? '')}"></label><button>Save note</button></form></section>`;
function dashboard(url) {
  const q = url.searchParams.get('q') ?? '', tag = url.searchParams.get('tag') ?? '';
  const page = Number(url.searchParams.get('page') ?? 1);
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(page * 20)) throw new Error('page must be a positive integer');
  const filter = { q, ...(tag ? { tag } : {}), limit: 20, offset: (page - 1) * 20 };
  const notes = store.listNotes(filter);
  const next = store.listNotes({ ...filter, limit: 1, offset: page * 20 }).length > 0;
  const pageLink = p => escape('/?' + new URLSearchParams({ q, tag, page: String(p) }));
  return layout(`<form method="get"><label>Search<input name="q" value="${escape(q)}"></label><label>Tag<input name="tag" value="${escape(tag)}"></label><button>Filter</button> <a href="/">Clear</a></form>
    <p class="tags">Tags: ${store.listTags().map(t => `<a href="${escape('/?' + new URLSearchParams({ tag: t.name }))}">${escape(t.name)}</a> (${t.count})`).join(' · ') || 'None'}</p>
    ${noteForm()}<h2>Notes</h2>${notes.map(n => `<article><div class="text">${escape(n.text)}</div><p class="tags">${n.tags.map(escape).join(', ')}</p><small>${escape(n.updatedAt)}</small><p><a href="/notes/${n.id}/edit">Edit</a> <form class="inline" method="post" action="/notes/${n.id}/delete"><button>Delete</button></form></p></article>`).join('') || '<p>No notes found.</p>'}
    <nav>${page > 1 ? `<a href="${pageLink(page - 1)}">Previous</a>` : ''}<span>Page ${page}</span>${next ? `<a href="${pageLink(page + 1)}">Next</a>` : ''}</nav>`);
}
async function body(req, json) {
  const chunks = []; let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 2_000_000) throw new Error('Request body is too large');
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (json) { try { return validateObject(JSON.parse(text)); } catch { throw new Error('Invalid JSON object'); } }
  return Object.fromEntries(new URLSearchParams(text));
}
function reply(res, status, value, json = true) {
  res.writeHead(status, { 'Content-Type': json ? 'application/json; charset=utf-8' : 'text/html; charset=utf-8' });
  res.end(json ? JSON.stringify(value) : value);
}
function missing() { throw Object.assign(new Error('Not found'), { status: 404 }); }
const server = createServer(async (req, res) => {
  let api = false, form;
  try {
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname, method = req.method;
    api = path.startsWith('/api/');
    if (api) {
      if (path === '/api/notes') {
        if (method === 'GET') {
          const options = {};
          for (const key of ['q', 'tag', 'limit', 'offset']) if (url.searchParams.has(key)) options[key] = ['limit', 'offset'].includes(key) ? Number(url.searchParams.get(key)) : url.searchParams.get(key);
          return reply(res, 200, store.listNotes(options));
        }
        if (method === 'POST') { const data = await body(req, true); return reply(res, 201, store.createNote(data.text, data.tags)); }
      }
      const match = path.match(/^\/api\/notes\/(\d+)$/);
      if (match && ['GET', 'PATCH', 'DELETE'].includes(method)) {
        const id = Number(match[1]);
        if (!store.getNote(id)) missing();
        if (method === 'GET') return reply(res, 200, store.getNote(id));
        if (method === 'DELETE') return reply(res, 200, store.deleteNote(id));
        return reply(res, 200, store.updateNote(id, await body(req, true)));
      }
      if (path === '/api/tags' && method === 'GET') return reply(res, 200, store.listTags());
      if (path === '/api/export' && method === 'GET') return reply(res, 200, exportNotes(store));
      if (path === '/api/import' && method === 'POST') { const data = await body(req, true); return reply(res, 201, importNotes(store, data.notes)); }
      missing();
    }
    if (path === '/' && method === 'GET') return reply(res, 200, dashboard(url), false);
    const edit = path.match(/^\/notes\/(\d+)\/edit$/);
    if (edit && method === 'GET') { const note = store.getNote(Number(edit[1])); if (!note) missing(); return reply(res, 200, layout(noteForm(note)), false); }
    const action = path.match(/^\/notes\/(\d+)(\/delete)?$/);
    if (method === 'POST' && (path === '/notes' || action)) {
      const id = action ? Number(action[1]) : undefined;
      if (id !== undefined && !store.getNote(id)) missing();
      if (action?.[2]) store.deleteNote(id);
      else {
        const data = await body(req, false);
        form = { ...data, id };
        const tags = (data.tags ?? '').split(',').map(t => t.trim()).filter(Boolean);
        if (id !== undefined) store.updateNote(id, { text: data.text, tags });
        else store.createNote(data.text, tags);
      }
      res.writeHead(303, { Location: '/' }); return res.end();
    }
    missing();
  } catch (error) {
    const status = error.status ?? 400;
    reply(res, status, api ? { error: error.message } : layout(form ? noteForm(form, error.message) : `<p class="error" role="alert">${escape(error.message)}</p><a href="/">Back to notes</a>`), api);
  }
});
server.listen(port, '127.0.0.1', () => console.log(JSON.stringify({ port: server.address().port })));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => store.close()));
