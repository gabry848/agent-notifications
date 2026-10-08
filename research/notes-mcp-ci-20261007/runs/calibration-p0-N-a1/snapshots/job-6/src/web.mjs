import { createServer } from 'node:http';
import { parseArgs } from 'node:util';
import { openStore, validateId } from './store.mjs';
import { importNotes, exportNotes } from './import.mjs';

const {values} = parseArgs({options:{db:{type:'string',default:'data/notes.sqlite'},port:{type:'string',default:'8080'}}});
const port = Number(values.port);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('invalid port');
const store = openStore(values.db);
const escape = value => String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const layout = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escape(title)}</title><style>body{font:16px system-ui;max-width:850px;margin:2rem auto;padding:0 1rem;color:#172334;background:#f6f8fb}article,section{background:white;padding:1rem;margin:1rem 0;border:1px solid #ccd6e0;border-radius:8px}textarea{width:95%;min-height:90px}input,button,select{padding:.5rem;margin:.3rem}a{color:#1254a0}.text{white-space:pre-wrap;overflow-wrap:anywhere}.error{color:#a00}label{display:block}.tags{color:#456}nav{margin:1rem 0}</style></head><body><h1><a href="/">Quick Notes</a></h1>${body}</body></html>`;
const form = (action, note={text:'',tags:[]}) => `<form method="post" action="${action}"><label>Text<textarea name="text" required maxlength="4000">${escape(note.text)}</textarea></label><label>Tags (comma separated)<input name="tags" value="${escape(note.tags.join(', '))}"></label><button>Save note</button></form>`;
const fail = (status,message) => { throw Object.assign(new Error(message),{status}); };
const requireNote = id => store.getNote(id) ?? fail(404,'Note not found');
const integerParam = (params,key,fallback) => {
  if (!params.has(key)) return fallback;
  const raw=params.get(key);
  if (!/^\d+$/.test(raw)) fail(400,`${key} must be an integer`);
  return Number(raw);
};
const filters = params => ({...(params.has('q') ? {q:params.get('q')} : {}),...(params.has('tag') && params.get('tag') !== '' ? {tag:params.get('tag')} : {})});
async function readBody(req, json) {
  let body='';
  req.setEncoding('utf8');
  for await (const chunk of req) {
    body+=chunk.toString();
    if (Buffer.byteLength(body)>1024*1024) fail(400,'Request body too large');
  }
  if (!json) return new URLSearchParams(body);
  let value;
  try { value=JSON.parse(body); } catch { fail(400,'Invalid JSON'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400,'JSON body must be an object');
  return value;
}
const server = createServer(async (req,res) => {
  const json = (value,status=200) => {res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));};
  const html = (value,status=200) => {res.writeHead(status,{'Content-Type':'text/html; charset=utf-8'});res.end(value);};
  const redirect = () => {res.writeHead(303,{Location:'/'});res.end();};
  let url;
  try {
    url=new URL(req.url,'http://localhost');
    const path=url.pathname, method=req.method;
    if (path === '/api/notes') {
      if (method === 'GET') return json(store.listNotes({...filters(url.searchParams),limit:integerParam(url.searchParams,'limit',50),offset:integerParam(url.searchParams,'offset',0)}));
      if (method === 'POST') {const body=await readBody(req,true);return json(store.createNote(body.text,body.tags),201);}
    }
    const apiMatch=path.match(/^\/api\/notes\/(\d+)$/);
    if (apiMatch && ['GET','PATCH','DELETE'].includes(method)) {
      const id=validateId(Number(apiMatch[1])); requireNote(id);
      if (method==='GET') return json(store.getNote(id));
      if (method==='DELETE') return json(store.deleteNote(id));
      return json(store.updateNote(id,await readBody(req,true)));
    }
    if (path==='/api/tags' && method==='GET') return json(store.listTags());
    if (path==='/api/export' && method==='GET') return json(exportNotes(store));
    if (path==='/api/import' && method==='POST') return json(importNotes(store,(await readBody(req,true)).notes),201);
    if (path==='/' && method==='GET') {
      const page=integerParam(url.searchParams,'page',1);
      if (page<1 || !Number.isSafeInteger(page) || !Number.isSafeInteger((page-1)*20)) fail(400,'invalid page');
      const filter=filters(url.searchParams);
      const notes=store.listNotes({...filter,limit:20,offset:(page-1)*20});
      const next=store.listNotes({...filter,limit:1,offset:page*20}).length>0;
      const link = p => '/?'+new URLSearchParams({...filter,page:String(p)});
      return html(layout('Quick Notes', `<form method="get"><label>Search<input name="q" value="${escape(filter.q ?? '')}"></label><label>Tag<select name="tag"><option value="">All tags</option>${store.listTags().map(t=>`<option value="${escape(t.name)}" ${filter.tag?.trim().toLowerCase()===t.name?'selected':''}>${escape(t.name)} (${t.count})</option>`).join('')}</select></label><button>Filter</button></form><section><h2>Create note</h2>${form('/notes')}</section><h2>Notes</h2>${notes.length ? notes.map(n=>`<article><div class="text">${escape(n.text)}</div><p class="tags">${n.tags.map(escape).join(', ')}</p><small>${escape(n.updatedAt)}</small> <a href="/notes/${n.id}/edit">Edit</a><form method="post" action="/notes/${n.id}/delete"><button>Delete</button></form></article>`).join('') : '<p>No notes found.</p>'}<nav>${page>1?`<a href="${escape(link(page-1))}">Previous</a>`:''} Page ${page} ${next?`<a href="${escape(link(page+1))}">Next</a>`:''}</nav>`));
    }
    const editMatch=path.match(/^\/notes\/(\d+)\/edit$/);
    if (editMatch && method==='GET') {
      const note=requireNote(validateId(Number(editMatch[1])));
      return html(layout('Edit note',`<h2>Edit note</h2>${form('/notes/'+note.id,note)}`));
    }
    const postMatch=path.match(/^\/notes\/(\d+)(\/delete)?$/);
    if (method==='POST' && (path==='/notes' || postMatch)) {
      const id=postMatch ? validateId(Number(postMatch[1])) : null;
      if (id) requireNote(id);
      if (postMatch?.[2]) {store.deleteNote(id);return redirect();}
      const body=await readBody(req,false);
      const text=body.get('text');
      const rawTags=body.get('tags') ?? '';
      const tags=rawTags.trim()==='' ? [] : rawTags.split(',');
      if (id) store.updateNote(id,{text,tags}); else store.createNote(text,tags);
      return redirect();
    }
    fail(404,'Not found');
  } catch (error) {
    const status=error.status ?? 400;
    if (url?.pathname.startsWith('/api/')) json({error:error.message},status);
    else html(layout('Error',`<h2 class="error">${escape(error.message)}</h2><p><a href="/">Back to notes</a></p>`),status);
  }
});
server.listen(port,'127.0.0.1',()=>console.log(JSON.stringify({port:server.address().port})));
function shutdown() { server.close(()=>{store.close();}); }
process.on('SIGINT',shutdown);
process.on('SIGTERM',shutdown);
