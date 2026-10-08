import { createServer } from 'node:http';
import { parseArgs } from 'node:util';
import { openStore } from './store.mjs';
import { importNotes, exportNotes } from './import.mjs';

const {values} = parseArgs({options:{db:{type:'string',default:'data/notes.sqlite'},port:{type:'string',default:'8080'}}});
const port = Number(values.port);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid port');
const store = openStore(values.db);
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function layout(body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Quick Notes</title><style>
  body{font:16px system-ui,sans-serif;max-width:850px;margin:2rem auto;padding:0 1rem;background:#f5f7fa;color:#202b3a}a{color:#165ca7}form,article,aside{background:white;padding:1rem;margin:1rem 0;border-radius:8px}label{display:block;margin:.5rem 0}textarea{width:95%;min-height:100px}input,textarea,button{font:inherit;padding:.4rem}button{cursor:pointer}article p{white-space:pre-wrap;overflow-wrap:anywhere}.tag{display:inline-block;margin-right:.5rem}.error{border:2px solid #b22;color:#a11;padding:1rem}nav{display:flex;gap:1rem}.delete{display:inline;padding:0}small{color:#586575}</style></head><body><h1><a href="/">Quick Notes</a></h1>${body}</body></html>`;
}
function noteForm(note={text:'',tags:[]}, action='/notes') {
  return `<form method="post" action="${action}"><label>Text<textarea name="text" required maxlength="4000">${escape(note.text)}</textarea></label><label>Tags (comma separated)<input name="tags" value="${escape(note.tags.join(', '))}"></label><button>Save note</button></form>`;
}
function dashboard(params) {
  const q = params.get('q') ?? '', tag = params.get('tag') ?? '';
  const page = params.has('page') ? Number(params.get('page')) : 1;
  if (!Number.isSafeInteger(page) || page < 1) throw new Error('Page must be a positive integer');
  const filter = {q,...(tag ? {tag} : {}),limit:20,offset:(page-1)*20};
  const notes = store.listNotes(filter);
  const link = target => '/?'+new URLSearchParams({q,tag,page:String(target)});
  return layout(`<form method="get" action="/"><label>Search<input name="q" value="${escape(q)}"></label><label>Tag<input name="tag" value="${escape(tag)}"></label><button>Filter</button> <a href="/">Clear</a></form>
  <aside><strong>Tags</strong> ${store.listTags().map(t => `<a class="tag" href="/?${escape(new URLSearchParams({tag:t.name}))}">${escape(t.name)} (${t.count})</a>`).join(' ') || 'No tags yet'}</aside>
  <h2>New note</h2>${noteForm()}<h2>Notes</h2>${notes.map(n => `<article><p>${escape(n.text)}</p><div>${n.tags.map(t => `<a class="tag" href="/?${escape(new URLSearchParams({tag:t}))}">${escape(t)}</a>`).join('')}</div><small>#${n.id} · ${escape(n.updatedAt)}</small><div><a href="/notes/${n.id}/edit">Edit</a> <form class="delete" method="post" action="/notes/${n.id}/delete"><button>Delete</button></form></div></article>`).join('') || '<p>No notes found.</p>'}
  <nav>${page > 1 ? `<a href="${escape(link(page-1))}">Previous</a>` : ''}<span>Page ${page}</span>${store.listNotes({...filter,limit:1,offset:page*20}).length ? `<a href="${escape(link(page+1))}">Next</a>` : ''}</nav>`);
}
async function body(req, json) {
  let size=0; const chunks=[];
  for await (const chunk of req) {
    size+=chunk.length;
    if (size > 2*1024*1024) throw new Error('Request body too large');
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!json) return Object.fromEntries(new URLSearchParams(raw));
  let data;
  try { data = JSON.parse(raw); } catch { throw new Error('Invalid JSON'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('JSON body must be an object');
  return data;
}
const formTags = value => typeof value === 'string' ? value.split(',').map(t => t.trim()).filter(Boolean) : [];
const server = createServer(async (req,res) => {
  const url = new URL(req.url,'http://localhost');
  const path = url.pathname, method = req.method;
  const api = path.startsWith('/api/');
  const send = (status,value) => {
    res.writeHead(status,{'Content-Type':api ? 'application/json; charset=utf-8' : 'text/html; charset=utf-8','X-Content-Type-Options':'nosniff'});
    res.end(api ? JSON.stringify(value) : value);
  };
  const missing = () => send(404,api ? {error:'Not found'} : layout('<h2>Not found</h2>'));
  const redirect = () => { res.writeHead(303,{Location:'/'}); res.end(); };
  try {
    if (path === '/api/notes') {
      if (method === 'GET') {
        const options = {};
        for (const key of ['q','tag','limit','offset']) if (url.searchParams.has(key)) options[key] = ['limit','offset'].includes(key) ? Number(url.searchParams.get(key)) : url.searchParams.get(key);
        return send(200,store.listNotes(options));
      }
      if (method === 'POST') { const data = await body(req,true); return send(201,store.createNote(data.text,data.tags)); }
    }
    const single = path.match(/^\/api\/notes\/(\d+)$/);
    if (single && ['GET','PATCH','DELETE'].includes(method)) {
      const id = Number(single[1]);
      if (!store.getNote(id)) return missing();
      if (method === 'GET') return send(200,store.getNote(id));
      if (method === 'PATCH') return send(200,store.updateNote(id,await body(req,true)));
      return send(200,store.deleteNote(id));
    }
    if (path === '/api/tags' && method === 'GET') return send(200,store.listTags());
    if (path === '/api/export' && method === 'GET') return send(200,exportNotes(store));
    if (path === '/api/import' && method === 'POST') return send(201,importNotes(store,(await body(req,true)).notes));
    if (path === '/' && method === 'GET') return send(200,dashboard(url.searchParams));
    if (path === '/notes' && method === 'POST') {
      const data = await body(req,false);
      store.createNote(data.text,formTags(data.tags)); return redirect();
    }
    const form = path.match(/^\/notes\/(\d+)(\/edit|\/delete)?$/);
    if (form) {
      const id = Number(form[1]), note = store.getNote(id);
      if (!note) return missing();
      if (method === 'GET' && form[2] === '/edit') return send(200,layout(`<h2>Edit note</h2>${noteForm(note,'/notes/'+id)}<a href="/">Cancel</a>`));
      if (method === 'POST' && form[2] === '/delete') { store.deleteNote(id); return redirect(); }
      if (method === 'POST' && !form[2]) {
        const data = await body(req,false);
        store.updateNote(id,{text:data.text,tags:formTags(data.tags)}); return redirect();
      }
    }
    return missing();
  } catch (err) {
    send(400,api ? {error:err.message} : layout(`<div class="error" role="alert">${escape(err.message)}</div><p><a href="/">Return to notes</a></p>`));
  }
});
server.listen(port,'127.0.0.1', () => console.log(JSON.stringify({port:server.address().port})));
server.on('error', err => { console.error(err.message); store.close(); process.exitCode=1; });
for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => server.close(() => {store.close();}));
