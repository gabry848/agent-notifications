import { createServer } from 'node:http';
import { parseArgs } from 'node:util';
import { openStore } from './store.mjs';
import { importNotes, exportNotes } from './import.mjs';
import { object, validateId } from './validation.mjs';

const { values } = parseArgs({ options: { db: { type: 'string', default: 'data/notes.sqlite' }, port: { type: 'string', default: '8080' } } });
const port = Number(values.port);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid port');
const store = openStore(values.db);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
function layout(body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Quick Notes</title><style>
  body{font:16px system-ui;max-width:850px;margin:2rem auto;padding:0 1rem;color:#233}textarea{width:100%;min-height:100px}input,textarea,button,select{font:inherit;padding:.4rem;box-sizing:border-box}label{display:block;margin:.6rem 0}article{border:1px solid #ccd;border-radius:8px;padding:1rem;margin:1rem 0}article p{white-space:pre-wrap;overflow-wrap:anywhere}.tags{color:#567}.error{color:#a00}nav a{margin-right:1rem}button{cursor:pointer}form.inline{display:inline}a{color:#1463a1}</style></head><body><h1><a href="/">Quick Notes</a></h1>${body}</body></html>`;
}
function noteForm(note) {
  return `<h2>${note ? 'Edit note' : 'Create note'}</h2><form method="post" action="${note ? '/notes/' + note.id : '/notes'}"><label>Text<textarea name="text" required maxlength="4000">${escape(note?.text)}</textarea></label><label>Tags (comma separated)<input name="tags" value="${escape(note?.tags.join(', '))}"></label><button type="submit">${note ? 'Save' : 'Create'}</button></form>`;
}
function options(params) {
  const result = {};
  for (const name of ['q', 'tag']) if (params.has(name)) result[name] = params.get(name);
  for (const name of ['limit', 'offset']) if (params.has(name)) result[name] = Number(params.get(name));
  return result;
}
function dashboard(params) {
  const q = params.get('q') ?? '', tag = params.get('tag') ?? '';
  const page = params.has('page') ? Number(params.get('page')) : 1;
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger((page - 1) * 20)) throw new Error('page must be a positive integer');
  const notes = store.listNotes({ q, ...(tag ? { tag } : {}), limit: 21, offset: (page - 1) * 20 });
  const link = p => '/?' + new URLSearchParams({ q, tag, page: String(p) });
  return layout(`<form method="get" action="/"><label>Search<input name="q" value="${escape(q)}"></label><label>Tag<input name="tag" value="${escape(tag)}"></label><button>Filter</button> <a href="/">Clear</a></form>
    <nav aria-label="Tags">${store.listTags().map(t => `<a href="${escape('/?' + new URLSearchParams({ tag: t.name }))}">${escape(t.name)} (${t.count})</a>`).join(' ')}</nav>
    ${noteForm()}<h2>Notes</h2>${notes.length ? notes.slice(0, 20).map(n => `<article><p>${escape(n.text)}</p><div class="tags">${n.tags.map(escape).join(', ')}</div><small>${escape(n.updatedAt)}</small><div><a href="/notes/${n.id}/edit">Edit</a> <form class="inline" method="post" action="/notes/${n.id}/delete"><button>Delete</button></form></div></article>`).join('') : '<p>No notes found.</p>'}
    <nav aria-label="Pagination">${page > 1 ? `<a href="${escape(link(page - 1))}">Previous</a>` : ''}<span>Page ${page}</span> ${notes.length > 20 ? `<a href="${escape(link(page + 1))}">Next</a>` : ''}</nav>`);
}
async function body(req, json) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 2 * 1024 * 1024) throw new Error('Request body too large');
    chunks.push(chunk);
  }
  const data = Buffer.concat(chunks).toString('utf8');
  if (json) return object(JSON.parse(data));
  const fields = new URLSearchParams(data);
  return { text: fields.get('text'), tags: (fields.get('tags') ?? '').split(',').map(t => t.trim()).filter(Boolean) };
}
function httpError(status, message) { return Object.assign(new Error(message), { status }); }
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const api = url.pathname.startsWith('/api/');
  const send = (status, value, json = api) => {
    res.writeHead(status, { 'Content-Type': json ? 'application/json; charset=utf-8' : 'text/html; charset=utf-8', 'X-Content-Type-Options': 'nosniff' });
    res.end(json ? JSON.stringify(value) : value);
  };
  const redirect = () => { res.writeHead(303, { Location: '/' }); res.end(); };
  try {
    const path = url.pathname, method = req.method;
    if (method === 'GET' && path === '/') return send(200, dashboard(url.searchParams));
    const edit = path.match(/^\/notes\/(\d+)\/edit$/);
    if (method === 'GET' && edit) {
      const note = store.getNote(validateId(Number(edit[1])));
      if (!note) throw httpError(404, 'Note not found');
      return send(200, layout(noteForm(note)));
    }
    if (method === 'POST' && path === '/notes') { const data = await body(req, false); store.createNote(data.text, data.tags); return redirect(); }
    const form = path.match(/^\/notes\/(\d+)(\/delete)?$/);
    if (method === 'POST' && form) {
      const id = validateId(Number(form[1]));
      if (!store.getNote(id)) throw httpError(404, 'Note not found');
      if (form[2]) store.deleteNote(id); else store.updateNote(id, await body(req, false));
      return redirect();
    }
    if (path === '/api/notes') {
      if (method === 'GET') return send(200, store.listNotes(options(url.searchParams)));
      if (method === 'POST') { const data = await body(req, true); return send(201, store.createNote(data.text, data.tags)); }
    }
    const single = path.match(/^\/api\/notes\/(\d+)$/);
    if (single && ['GET', 'PATCH', 'DELETE'].includes(method)) {
      const id = validateId(Number(single[1]));
      const note = store.getNote(id);
      if (!note) throw httpError(404, 'Note not found');
      if (method === 'GET') return send(200, note);
      if (method === 'PATCH') return send(200, store.updateNote(id, await body(req, true)));
      return send(200, store.deleteNote(id));
    }
    if (method === 'GET' && path === '/api/tags') return send(200, store.listTags());
    if (method === 'GET' && path === '/api/export') return send(200, exportNotes(store));
    if (method === 'POST' && path === '/api/import') return send(201, importNotes(store, (await body(req, true)).notes));
    throw httpError(404, 'Route not found');
  } catch (error) {
    send(error.status ?? 400, api ? { error: error.message } : layout(`<h2 class="error">${escape(error.message)}</h2><p><a href="/">Back to notes</a></p>`));
  }
});
server.listen(port, '127.0.0.1', () => process.stdout.write(JSON.stringify({ port: server.address().port }) + '\n'));
function shutdown() { server.close(() => { store.close(); }); }
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
