import { createServer } from 'node:http';
import { openStore } from './store.mjs';
import { importNotes, exportNotes } from './import.mjs';
import { options } from './cli.mjs';
import { objectValue } from './validation.mjs';

const config = options(), store = openStore(config.db);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const layout = (body, error = '') => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Quick Notes</title><style>body{font:16px system-ui;max-width:850px;margin:2rem auto;padding:0 1rem;background:#f6f7fa;color:#202536}article,section{background:white;padding:1rem;margin:1rem 0;border-radius:8px}textarea{width:95%;min-height:100px}input,button{padding:.5rem;margin:.3rem}pre{white-space:pre-wrap;font:inherit;overflow-wrap:anywhere}.error{color:#a00;background:#fee;padding:1rem}.tags{color:#526}nav{margin:1rem 0}a{color:#245ab2}</style></head><body><h1><a href="/">Quick Notes</a></h1>${error ? `<p class="error" role="alert">${escape(error)}</p>` : ''}${body}</body></html>`;
const form = (note = {}, action = '/notes') => `<form method="post" action="${action}"><label>Text<br><textarea name="text" required maxlength="4000">${escape(note.text)}</textarea></label><br><label>Tags (comma separated) <input name="tags" value="${escape(Array.isArray(note.tags) ? note.tags.join(', ') : note.tags)}"></label><button type="submit">Save note</button></form>`;
function dashboard(url, error = '', draft = {}) {
  const q = url.searchParams.get('q') ?? '', tag = url.searchParams.get('tag') ?? '';
  const page = Number(url.searchParams.get('page') ?? 1);
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger((page - 1) * 20)) throw new Error('page must be a positive integer');
  const filters = {q, ...(tag ? {tag} : {})};
  const notes = store.listNotes({...filters,limit:20,offset:(page-1)*20});
  const next = store.listNotes({...filters,limit:1,offset:page*20}).length > 0;
  const link = p => '/?' + new URLSearchParams({q,tag,page:String(p)});
  return layout(`<section><h2>Create note</h2>${form(draft)}</section><form method="get" action="/"><label>Search <input name="q" value="${escape(q)}"></label><label>Tag <input name="tag" value="${escape(tag)}"></label><button>Filter</button></form><nav>Tags: ${store.listTags().map(t => `<a href="/?${escape(new URLSearchParams({tag:t.name}))}">${escape(t.name)} (${t.count})</a>`).join(' · ')}</nav>${notes.map(n => `<article><pre>${escape(n.text)}</pre><p class="tags">${n.tags.map(escape).join(', ')}</p><small>${escape(n.updatedAt)}</small> <a href="/notes/${n.id}/edit">Edit</a><form method="post" action="/notes/${n.id}/delete"><button>Delete</button></form></article>`).join('') || '<p>No notes found.</p>'}<nav>${page > 1 ? `<a href="${escape(link(page-1))}">Previous</a>` : ''} Page ${page} ${next ? `<a href="${escape(link(page+1))}">Next</a>` : ''}</nav>`,error);
}
async function body(req, json) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 2 * 1024 * 1024) throw new Error('Request body too large');
    chunks.push(chunk);
  }
  const data = Buffer.concat(chunks).toString('utf8');
  if (json) {
    try { return objectValue(JSON.parse(data)); }
    catch { throw new Error('Body must be a JSON object'); }
  }
  return Object.fromEntries(new URLSearchParams(data));
}
const formPatch = data => ({text:data.text,tags:typeof data.tags === 'string' ? data.tags.split(',').map(t => t.trim()).filter(Boolean) : []});
const notFound = () => { const error = new Error('Not found'); error.status = 404; throw error; };
const server = createServer(async (req,res) => {
  const url = new URL(req.url,'http://localhost'), path = url.pathname, method = req.method;
  const api = path.startsWith('/api/');
  const reply = (status, value, json = api) => {
    res.writeHead(status,{'Content-Type':json ? 'application/json; charset=utf-8' : 'text/html; charset=utf-8'});
    res.end(json ? JSON.stringify(value) : value);
  };
  const redirect = () => { res.writeHead(303,{Location:'/'}); res.end(); };
  let submitted;
  try {
    if (api) {
      const match = path.match(/^\/api\/notes\/([1-9]\d*)$/);
      if (path === '/api/notes' && method === 'GET') {
        const args = {};
        for (const key of ['q','tag','limit','offset']) if (url.searchParams.has(key)) {
          const value = url.searchParams.get(key);
          if (['limit','offset'].includes(key) && !/^\d+$/.test(value)) throw new Error(`${key} must be an integer`);
          args[key] = ['limit','offset'].includes(key) ? Number(value) : value;
        }
        reply(200,store.listNotes(args));
      } else if (path === '/api/notes' && method === 'POST') {
        const data = await body(req,true); reply(201,store.createNote(data.text,data.tags));
      } else if (match && ['GET','PATCH','DELETE'].includes(method)) {
        const id = Number(match[1]);
        if (!store.getNote(id)) notFound();
        if (method === 'GET') reply(200,store.getNote(id));
        if (method === 'PATCH') reply(200,store.updateNote(id,await body(req,true)));
        if (method === 'DELETE') reply(200,store.deleteNote(id));
      } else if (path === '/api/tags' && method === 'GET') reply(200,store.listTags());
      else if (path === '/api/export' && method === 'GET') reply(200,exportNotes(store));
      else if (path === '/api/import' && method === 'POST') reply(201,importNotes(store,(await body(req,true)).notes));
      else notFound();
      return;
    }
    if (path === '/' && method === 'GET') { reply(200,dashboard(url)); return; }
    const edit = path.match(/^\/notes\/([1-9]\d*)\/edit$/);
    if (edit && method === 'GET') {
      const note = store.getNote(Number(edit[1])); if (!note) notFound();
      reply(200,layout(`<h2>Edit note</h2>${form(note,`/notes/${note.id}`)}`)); return;
    }
    const action = path.match(/^\/notes\/([1-9]\d*)(\/delete)?$/);
    if (method === 'POST' && (path === '/notes' || action)) {
      if (action && !store.getNote(Number(action[1]))) notFound();
      if (action?.[2]) store.deleteNote(Number(action[1]));
      else {
        submitted = await body(req,false);
        const patch = formPatch(submitted);
        if (action) store.updateNote(Number(action[1]),patch);
        else store.createNote(patch.text,patch.tags);
      }
      redirect(); return;
    }
    notFound();
  } catch (error) {
    const status = error.status ?? 400;
    if (api) reply(status,{error:error.message});
    else if (submitted && path === '/notes') reply(status,dashboard(new URL('http://localhost/'),error.message,submitted));
    else if (submitted) reply(status,layout(`<h2>Edit note</h2>${form(submitted,path)}`,error.message));
    else reply(status,layout('<p><a href="/">Back to notes</a></p>',error.message));
  }
});
server.listen(config.port,'127.0.0.1',() => console.log(JSON.stringify({port:server.address().port})));
let closing = false;
for (const signal of ['SIGINT','SIGTERM']) process.on(signal,() => {
  if (closing) return; closing = true;
  server.close(() => { store.close(); });
  server.closeIdleConnections();
});
