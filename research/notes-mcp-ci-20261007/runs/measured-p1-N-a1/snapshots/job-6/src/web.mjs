import { createServer } from 'node:http';
import { openStore, validateId } from './store.mjs';
import { importNotes, exportNotes } from './import.mjs';
import { options } from './cli.mjs';

const config = options({ db: 'data/notes.sqlite', port: '8080' });
const port = Number(config.port);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid port');
const store = openStore(config.db);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const page = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)} · Quick Notes</title><style>
body{font:16px system-ui,sans-serif;max-width:850px;margin:2rem auto;padding:0 1rem;background:#f7f8fb;color:#202838}a{color:#254eb8}article,section{background:white;padding:1rem;margin:1rem 0;border:1px solid #dce0e9;border-radius:8px}label{display:block;margin:.6rem 0}input,textarea,button{font:inherit;padding:.5rem;border:1px solid #aab3c5;border-radius:4px}textarea{display:block;width:95%;min-height:100px}button{cursor:pointer;background:#e8edfc}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}.tags{color:#55647f}.actions{display:flex;gap:1rem;align-items:center}.error{color:#a11b28;background:#fff0f0;padding:1rem}nav{display:flex;gap:1rem;flex-wrap:wrap}small{color:#55647f}</style></head><body><header><h1><a href="/">Quick Notes</a></h1></header>${body}</body></html>`;
function formContent(note = {}, error = '') {
  return `${error ? `<p class="error" role="alert">${escape(error)}</p>` : ''}<section><h2>${note.id ? 'Edit note' : 'Create note'}</h2><form method="post" action="${note.id ? `/notes/${note.id}` : '/notes'}"><label>Text<textarea name="text" maxlength="4000" required>${escape(note.text)}</textarea></label><label>Tags (comma separated)<input name="tags" value="${escape(Array.isArray(note.tags) ? note.tags.join(', ') : note.tags)}"></label><button type="submit">${note.id ? 'Save changes' : 'Create note'}</button> <a href="/">Cancel</a></form></section>`;
}
function noteForm(note = {}, error = '') {
  return page(note.id ? 'Edit note' : 'Create note', formContent(note, error));
}
function dashboard(url) {
  const q = url.searchParams.get('q') ?? '';
  const tag = url.searchParams.get('tag') ?? '';
  const number = url.searchParams.has('page') ? Number(url.searchParams.get('page')) : 1;
  if (!Number.isSafeInteger(number) || number < 1 || !Number.isSafeInteger(number * 20)) throw new Error('Page must be a positive integer');
  const filters = { q, ...(tag ? { tag } : {}), limit: 20, offset: (number - 1) * 20 };
  const notes = store.listNotes(filters);
  const next = store.listNotes({ ...filters, offset: number * 20, limit: 1 }).length > 0;
  const link = n => '/?' + new URLSearchParams({ q, tag, page: String(n) });
  const tags = store.listTags();
  return page('Dashboard', `<section><h2>Find notes</h2><form method="get" action="/"><label>Search <input name="q" value="${escape(q)}"></label><label>Tag <select name="tag"><option value="">All tags</option>${tags.map(t => `<option value="${escape(t.name)}"${t.name === tag.trim().toLowerCase() ? ' selected' : ''}>${escape(t.name)} (${t.count})</option>`).join('')}</select></label><button>Search</button> <a href="/">Reset</a></form><p class="tags">${tags.map(t => `<a href="${escape('/?' + new URLSearchParams({ tag: t.name }))}">${escape(t.name)} (${t.count})</a>`).join(' · ') || 'No tags yet'}</p></section>
${formContent()}
<h2>Notes</h2>${notes.map(n => `<article><pre>${escape(n.text)}</pre><p class="tags">${n.tags.map(escape).join(' · ')}</p><small>#${n.id} · Updated ${escape(n.updatedAt)}</small><div class="actions"><a href="/notes/${n.id}/edit">Edit</a><form method="post" action="/notes/${n.id}/delete"><button>Delete</button></form></div></article>`).join('') || '<p>No notes found.</p>'}<nav aria-label="Pagination">${number > 1 ? `<a href="${escape(link(number - 1))}">Previous</a>` : ''}<span>Page ${number}</span>${next ? `<a href="${escape(link(number + 1))}">Next</a>` : ''}</nav>`);
}
async function body(req, json) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 2 * 1024 * 1024) throw new Error('Request body exceeds 2 MiB');
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!json) return Object.fromEntries(new URLSearchParams(raw));
  let value;
  try { value = JSON.parse(raw); } catch { throw new Error('Invalid JSON'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a JSON object');
  return value;
}
const notFound = () => { throw Object.assign(new Error('Not found'), { status: 404 }); };
const requireNote = note => note ?? notFound();
function collectionQuery(url) {
  const result = {};
  for (const key of ['q', 'tag']) if (url.searchParams.has(key)) result[key] = url.searchParams.get(key);
  for (const key of ['limit', 'offset']) if (url.searchParams.has(key)) {
    const raw = url.searchParams.get(key);
    if (!/^\d+$/.test(raw)) throw new Error(`Invalid ${key}`);
    result[key] = Number(raw);
  }
  return result;
}
const server = createServer(async (req, res) => {
  let api = false;
  const send = (status, value, json = api) => {
    res.writeHead(status, { 'Content-Type': json ? 'application/json; charset=utf-8' : 'text/html; charset=utf-8', 'X-Content-Type-Options': 'nosniff' });
    res.end(json ? JSON.stringify(value) : value);
  };
  const redirect = () => { res.writeHead(303, { Location: '/' }); res.end(); };
  try {
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname;
    const method = req.method;
    api = path.startsWith('/api/');
    if (path === '/api/notes') {
      if (method === 'GET') return send(200, store.listNotes(collectionQuery(url)));
      if (method === 'POST') { const a = await body(req, true); return send(201, store.createNote(a.text, a.tags)); }
    }
    const single = path.match(/^\/api\/notes\/(\d+)$/);
    if (single) {
      const id = validateId(Number(single[1]));
      requireNote(store.getNote(id));
      if (method === 'GET') return send(200, store.getNote(id));
      if (method === 'PATCH') return send(200, requireNote(store.updateNote(id, await body(req, true))));
      if (method === 'DELETE') return send(200, store.deleteNote(id));
    }
    if (path === '/api/tags' && method === 'GET') return send(200, store.listTags());
    if (path === '/api/export' && method === 'GET') return send(200, exportNotes(store));
    if (path === '/api/import' && method === 'POST') return send(201, importNotes(store, (await body(req, true)).notes));
    if (path === '/' && method === 'GET') return send(200, dashboard(url));
    const edit = path.match(/^\/notes\/(\d+)\/edit$/);
    if (edit && method === 'GET') return send(200, noteForm(requireNote(store.getNote(Number(edit[1])))));
    const deletion = path.match(/^\/notes\/(\d+)\/delete$/);
    if (deletion && method === 'POST') {
      if (!store.deleteNote(Number(deletion[1]))) notFound();
      return redirect();
    }
    const update = path.match(/^\/notes\/(\d+)$/);
    if (method === 'POST' && (path === '/notes' || update)) {
      const id = update ? Number(update[1]) : undefined;
      if (id) requireNote(store.getNote(id));
      const a = await body(req, false);
      try {
        const tags = (a.tags ?? '').split(',').map(t => t.trim()).filter(Boolean);
        if (id) store.updateNote(id, { text: a.text, tags });
        else store.createNote(a.text, tags);
        return redirect();
      } catch (error) { return send(400, noteForm({ id, text: a.text, tags: a.tags }, error.message)); }
    }
    notFound();
  } catch (error) {
    send(error.status ?? 400, api ? { error: error.message } : page('Error', `<p class="error" role="alert">${escape(error.message)}</p><a href="/">Back to notes</a>`));
  }
});
server.listen(port, '127.0.0.1', () => console.log(JSON.stringify({ port: server.address().port })));
server.on('error', error => { console.error(error.message); store.close(); process.exitCode = 1; });
let closing = false;
function shutdown() {
  if (closing) return;
  closing = true;
  server.close(() => store.close());
  server.closeIdleConnections();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
