import { createServer } from 'node:http';
import { parseArgs } from 'node:util';
import { openStore } from './store.mjs';
import { importNotes, exportNotes } from './import.mjs';
import { object, validId } from './validation.mjs';

const {values} = parseArgs({options:{db:{type:'string',default:'data/notes.sqlite'},port:{type:'string',default:'8080'}}});
const port = Number(values.port);
if (!Number.isInteger(port) || port<0 || port>65535) throw new Error('Invalid port');
const store = openStore(values.db);
const escape = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const layout = (title,body) => `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)} · Quick Notes</title><style>body{font:16px system-ui;max-width:850px;margin:2rem auto;padding:0 1rem;background:#f6f8fb;color:#182838}a{color:#235ab0}article,section{background:white;border:1px solid #d7dfea;border-radius:8px;padding:1rem;margin:1rem 0}textarea{width:95%;min-height:100px}input,textarea,button,select{font:inherit;padding:.4rem;margin:.25rem}label{display:block}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}.tags{color:#53677f}.error{color:#a01818}nav{display:flex;gap:1rem}</style><body><h1><a href="/">Quick Notes</a></h1>${body}</body></html>`;
const form = (action,note={},heading='Create note') => `<section><h2>${escape(heading)}</h2><form method="post" action="${action}"><label>Text <textarea name="text" maxlength="4000" required>${escape(note.text)}</textarea></label><label>Tags (comma separated) <input name="tags" value="${escape(Array.isArray(note.tags)?note.tags.join(', '):note.tags)}"></label><button>Save note</button></form></section>`;
const send = (res,status,body,type='application/json') => { res.writeHead(status,{'Content-Type':type+'; charset=utf-8','X-Content-Type-Options':'nosniff'}); res.end(type==='application/json'?JSON.stringify(body):body); };
const html = (res,status,body) => send(res,status,body,'text/html');
const redirect = res => {res.writeHead(303,{Location:'/'});res.end();};
const missing = () => {throw Object.assign(new Error('Not found'),{status:404});};
async function body(req,json=true) {
  let raw='';
  for await (const chunk of req) {raw+=chunk; if (Buffer.byteLength(raw)>1_000_000) throw new Error('Request body too large');}
  if (json) return object(JSON.parse(raw));
  return Object.fromEntries(new URLSearchParams(raw));
}
const formTags = tags => tags === undefined || tags.trim()==='' ? [] : tags.split(',');
function filters(params,numeric=true) {
  const options={};
  for (const name of ['q','tag']) if (params.has(name)) options[name]=params.get(name);
  if (numeric) for (const name of ['limit','offset']) if (params.has(name)) {
    if (!/^\d+$/.test(params.get(name))) throw new Error(`${name} must be an integer`);
    options[name]=Number(params.get(name));
  }
  return options;
}
function dashboard(url) {
  const options = filters(url.searchParams,false);
  if (options.tag==='') delete options.tag;
  const raw = url.searchParams.get('page')??'1';
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw)<1) throw new Error('page must be a positive integer');
  const page=Number(raw);
  const notes=store.listNotes({...options,limit:20,offset:(page-1)*20});
  const next=store.listNotes({...options,limit:1,offset:page*20}).length;
  const pageLink = p => {const params=new URLSearchParams(url.searchParams);params.set('page',p);return '/?'+escape(params.toString());};
  return layout('Dashboard',`<form method="get"><label>Search <input name="q" value="${escape(options.q)}"></label><label>Tag <input name="tag" value="${escape(options.tag)}"></label><button>Filter</button> <a href="/">Clear</a></form><p class="tags">Tags: ${store.listTags().map(t=>`<a href="/?tag=${escape(encodeURIComponent(t.name))}">${escape(t.name)} (${t.count})</a>`).join(' · ')||'None'}</p>${form('/notes')}<h2>Notes</h2>${notes.map(n=>`<article><pre>${escape(n.text)}</pre><p class="tags">${n.tags.map(escape).join(' · ')}</p><small>${escape(n.updatedAt)}</small> <a href="/notes/${n.id}/edit">Edit</a><form method="post" action="/notes/${n.id}/delete"><button>Delete</button></form></article>`).join('')||'<p>No notes found.</p>'}<nav>${page>1?`<a href="${pageLink(page-1)}">Previous</a>`:''}<span>Page ${page}</span>${next?`<a href="${pageLink(page+1)}">Next</a>`:''}</nav>`);
}
const server=createServer(async (req,res)=>{
  let url;
  try {
    url=new URL(req.url,'http://localhost');
    const path=url.pathname, method=req.method;
    if (path==='/api/notes') {
      if (method==='GET') return send(res,200,store.listNotes(filters(url.searchParams)));
      if (method==='POST') {const data=await body(req);return send(res,201,store.createNote(data.text,data.tags));}
    }
    const api=path.match(/^\/api\/notes\/(\d+)$/);
    if (api && ['GET','PATCH','DELETE'].includes(method)) {
      const id=validId(Number(api[1]));
      if (!store.getNote(id)) missing();
      if (method==='GET') return send(res,200,store.getNote(id));
      if (method==='PATCH') return send(res,200,store.updateNote(id,await body(req)));
      return send(res,200,store.deleteNote(id));
    }
    if (path==='/api/tags' && method==='GET') return send(res,200,store.listTags());
    if (path==='/api/export' && method==='GET') return send(res,200,exportNotes(store));
    if (path==='/api/import' && method==='POST') return send(res,201,importNotes(store,(await body(req)).notes));
    if (path==='/' && method==='GET') return html(res,200,dashboard(url));
    const edit=path.match(/^\/notes\/(\d+)\/edit$/);
    if (edit && method==='GET') {
      const note=store.getNote(validId(Number(edit[1]))); if (!note) missing();
      return html(res,200,layout('Edit note',form(`/notes/${note.id}`,note,'Edit note')));
    }
    const action=path.match(/^\/notes\/(\d+)(\/delete)?$/);
    if (method==='POST' && (path==='/notes'||action)) {
      const id=action?validId(Number(action[1])):null;
      if (id && !store.getNote(id)) missing();
      if (action?.[2]) {store.deleteNote(id);return redirect(res);}
      const data=await body(req,false);
      try {
        const patch={text:data.text,tags:formTags(data.tags)};
        if (id) store.updateNote(id,patch); else store.createNote(patch.text,patch.tags);
        return redirect(res);
      } catch(error) {
        return html(res,400,layout('Validation error',`<p class="error" role="alert">${escape(error.message)}</p>${form(path,data,id?'Edit note':'Create note')}`));
      }
    }
    missing();
  } catch(error) {
    const status=error.status??400;
    if (url?.pathname.startsWith('/api/')) send(res,status,{error:error.message});
    else html(res,status,layout('Error',`<p class="error" role="alert">${escape(error.message)}</p><a href="/">Back to notes</a>`));
  }
});
server.listen(port,'127.0.0.1',()=>console.log(JSON.stringify({port:server.address().port})));
let stopping=false;
function shutdown() {if (stopping) return;stopping=true;server.close(()=>store.close());server.closeIdleConnections();}
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
