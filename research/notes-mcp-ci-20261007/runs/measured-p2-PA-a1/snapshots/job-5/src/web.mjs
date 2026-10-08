import { createServer } from 'node:http';
import { openStore } from './store.mjs';
import { exportNotes, importNotes } from './import.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name)+1] : fallback;
const store = openStore(option('--db','data/notes.sqlite'));
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const layout = body => `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Quick Notes</title><style>body{font:16px system-ui;max-width:850px;margin:2rem auto;padding:0 1rem;background:#f7f8fb;color:#202735}article,section{background:white;padding:1rem;margin:1rem 0;border:1px solid #ddd;border-radius:8px}textarea{display:block;width:95%;min-height:100px}input,button{padding:.5rem;margin:.3rem}pre{white-space:pre-wrap;font:inherit}.error{color:#a00}a{color:#245bba}</style><h1><a href="/">Quick Notes</a></h1>${body}</html>`;
const form = (note = {}) => `<form method="post" action="${note.id ? '/notes/'+note.id : '/notes'}"><label>Note<textarea name="text" required maxlength="4000">${escape(note.text)}</textarea></label><label>Tags (comma separated)<input name="tags" value="${escape(Array.isArray(note.tags) ? note.tags.join(', ') : note.tags)}"></label><button>Save note</button></form>`;
const filterOptions = params => {
  const result = {};
  for (const key of ['q','tag']) if (params.has(key)) result[key] = params.get(key);
  for (const key of ['limit','offset']) if (params.has(key)) {
    const raw = params.get(key);
    if (!/^\d+$/.test(raw)) throw new Error(`${key} must be an integer`);
    result[key] = Number(raw);
  }
  return result;
};
function dashboard(params) {
  const pageRaw = params.get('page') ?? '1';
  if (!/^\d+$/.test(pageRaw) || !Number.isSafeInteger(Number(pageRaw)) || Number(pageRaw) < 1) throw new Error('page must be a positive integer');
  const page = Number(pageRaw);
  const options = filterOptions(new URLSearchParams([...params].filter(([k]) => k === 'q' || k === 'tag')));
  const notes = store.listNotes({...options,limit:20,offset:(page-1)*20});
  const link = p => { const query = new URLSearchParams(options); query.set('page',p); return '/?'+escape(query.toString()); };
  return layout(`<form method="get"><label>Search<input name="q" value="${escape(options.q)}"></label><label>Tag<input name="tag" value="${escape(options.tag)}"></label><button>Filter</button></form>
    <nav>${store.listTags().map(t => `<a href="/?tag=${escape(encodeURIComponent(t.name))}">${escape(t.name)} (${t.count})</a>`).join(' · ')}</nav>
    <section><h2>Create note</h2>${form()}</section>
    ${notes.map(n => `<article><pre>${escape(n.text)}</pre><p>${n.tags.map(escape).join(', ')}</p><small>${escape(n.updatedAt)}</small> <a href="/notes/${n.id}/edit">Edit</a><form method="post" action="/notes/${n.id}/delete"><button>Delete</button></form></article>`).join('') || '<p>No notes found.</p>'}
    <nav>${page > 1 ? `<a href="${link(page-1)}">Previous</a>` : ''} Page ${page} ${store.listNotes({...options,limit:1,offset:page*20}).length ? `<a href="${link(page+1)}">Next</a>` : ''}</nav>`);
}
async function body(req, json) {
  let text = '';
  for await (const chunk of req) { text += chunk; if (text.length > 2_000_000) throw new Error('Request too large'); }
  if (json) {
    const value = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object');
    return value;
  }
  const fields = new URLSearchParams(text);
  const tags = fields.get('tags') ?? '';
  return {text:fields.get('text'),tags:tags.trim() ? tags.split(',') : []};
}
const server = createServer(async (req,res) => {
  let api = false;
  const send = (status,value,json = api) => {
    res.writeHead(status,{'Content-Type':json ? 'application/json; charset=utf-8' : 'text/html; charset=utf-8'});
    res.end(json ? JSON.stringify(value) : value);
  };
  const missing = () => send(404,api ? {error:'Not found'} : layout('<h2>Not found</h2>'));
  const redirect = () => {res.writeHead(303,{Location:'/'});res.end();};
  try {
    const url = new URL(req.url,'http://localhost');
    const path = url.pathname; api = path.startsWith('/api/');
    const method = req.method;
    if (path === '/api/notes') {
      if (method === 'GET') return send(200,store.listNotes(filterOptions(url.searchParams)));
      if (method === 'POST') {const a = await body(req,true);return send(201,store.createNote(a.text,a.tags));}
    }
    const single = path.match(/^\/api\/notes\/(\d+)$/);
    if (single) {
      const id = Number(single[1]);
      if (!store.getNote(id)) return missing();
      if (method === 'GET') return send(200,store.getNote(id));
      if (method === 'PATCH') return send(200,store.updateNote(id,await body(req,true)));
      if (method === 'DELETE') return send(200,store.deleteNote(id));
    }
    if (path === '/api/tags' && method === 'GET') return send(200,store.listTags());
    if (path === '/api/export' && method === 'GET') return send(200,exportNotes(store));
    if (path === '/api/import' && method === 'POST') return send(201,importNotes(store,(await body(req,true)).notes));
    if (path === '/' && method === 'GET') return send(200,dashboard(url.searchParams));
    if (path === '/notes' && method === 'POST') {const a = await body(req,false);store.createNote(a.text,a.tags);return redirect();}
    const route = path.match(/^\/notes\/(\d+)(\/edit|\/delete)?$/);
    if (route) {
      const id = Number(route[1]), note = store.getNote(id);
      if (!note) return missing();
      if (method === 'GET' && route[2] === '/edit') return send(200,layout(`<h2>Edit note</h2>${form(note)}`));
      if (method === 'POST' && route[2] === '/delete') {store.deleteNote(id);return redirect();}
      if (method === 'POST' && !route[2]) {store.updateNote(id,await body(req,false));return redirect();}
    }
    missing();
  } catch (error) {
    send(400,api ? {error:error.message} : layout(`<h2 class="error">Validation error</h2><p class="error">${escape(error.message)}</p><a href="/">Back to notes</a>`));
  }
});
server.listen(Number(option('--port','8080')),'127.0.0.1',() => console.log(JSON.stringify({port:server.address().port})));
for (const signal of ['SIGINT','SIGTERM']) process.on(signal,() => server.close(() => {store.close();process.exit(0);}));
