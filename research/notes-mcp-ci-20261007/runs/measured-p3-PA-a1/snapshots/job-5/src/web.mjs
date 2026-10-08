import { createServer } from 'node:http';
import { parseArgs } from 'node:util';
import { openStore } from './store.mjs';
import { exportNotes } from './service.mjs';
import { importNotes } from './import.mjs';

const {values} = parseArgs({options:{db:{type:'string',default:'data/notes.sqlite'},port:{type:'string',default:'8080'}}});
const port = Number(values.port);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid port');
const store = openStore(values.db);
const escape = value => String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const layout = (body,title='Quick Notes') => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title><style>body{font:16px system-ui;max-width:850px;margin:2rem auto;padding:0 1rem;background:#f5f7fa;color:#18202d}article,form{padding:1rem;background:white;margin:1rem 0;border-radius:8px}textarea{width:95%;min-height:90px}input,button,select{padding:.5rem;margin:.2rem}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}.tags{color:#546}a{color:#235ca5}.error{color:#a00}</style></head><body><h1><a href="/">Quick Notes</a></h1>${body}</body></html>`;
const noteForm = (note={text:'',tags:[]}) => `<form method="post" action="${note.id ? '/notes/'+note.id : '/notes'}"><label>Text<textarea name="text" required maxlength="4000">${escape(note.text)}</textarea></label><label>Tags (comma separated)<input name="tags" value="${escape(note.tags.join(', '))}"></label><button type="submit">${note.id ? 'Save' : 'Create note'}</button></form>`;
const json = (res,value,status=200) => {res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));};
const html = (res,body,status=200) => {res.writeHead(status,{'Content-Type':'text/html; charset=utf-8'});res.end(layout(body));};
const notFound = () => { const error=new Error('Not found'); error.status=404; throw error; };
const integer = (params,key,fallback) => {
  if (!params.has(key)) return fallback;
  const raw=params.get(key);
  if (!/^\d+$/.test(raw)) throw new Error(`${key} must be an integer`);
  return Number(raw);
};
const filters = params => ({...(params.has('q') ? {q:params.get('q')} : {}),...(params.has('tag') && params.get('tag') ? {tag:params.get('tag')} : {})});
async function body(req,isJson) {
  let raw='';
  for await (const chunk of req) {
    raw+=chunk;
    if (Buffer.byteLength(raw)>1024*1024) throw new Error('Request body too large');
  }
  if (isJson) {
    const result=JSON.parse(raw);
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Body must be an object');
    return result;
  }
  const form=new URLSearchParams(raw);
  return {text:form.get('text') ?? '',tags:(form.get('tags') ?? '').split(',').map(t=>t.trim()).filter(Boolean)};
}
const server=createServer(async (req,res)=>{
  const url=new URL(req.url,'http://localhost');
  const path=url.pathname;
  const api=path.startsWith('/api/');
  try {
    const match=path.match(/^\/(api\/)?notes\/([1-9]\d*)(?:\/(edit|delete))?$/);
    if (api) {
      if (path==='/api/notes' && req.method==='GET') {
        json(res,store.listNotes({...filters(url.searchParams),limit:integer(url.searchParams,'limit',50),offset:integer(url.searchParams,'offset',0)})); return;
      }
      if (path==='/api/notes' && req.method==='POST') {
        const data=await body(req,true); json(res,store.createNote(data.text,data.tags),201); return;
      }
      if (match && !match[3]) {
        const id=Number(match[2]);
        if (!store.getNote(id)) notFound();
        if (req.method==='GET') {json(res,store.getNote(id));return;}
        if (req.method==='PATCH') {json(res,store.updateNote(id,await body(req,true)));return;}
        if (req.method==='DELETE') {json(res,store.deleteNote(id));return;}
      }
      if (path==='/api/tags' && req.method==='GET') {json(res,store.listTags());return;}
      if (path==='/api/export' && req.method==='GET') {json(res,exportNotes(store));return;}
      if (path==='/api/import' && req.method==='POST') {json(res,importNotes(store,(await body(req,true)).notes),201);return;}
      notFound();
    }
    if (path==='/' && req.method==='GET') {
      const page=integer(url.searchParams,'page',1);
      if (!Number.isSafeInteger(page) || page < 1) throw new Error('page must be a positive integer');
      const filter=filters(url.searchParams);
      const notes=store.listNotes({...filter,limit:20,offset:(page-1)*20});
      const next=store.listNotes({...filter,limit:1,offset:page*20}).length;
      const pageUrl = p => {const params=new URLSearchParams(url.searchParams);params.set('page',p);return '/?'+escape(params.toString());};
      html(res,`<form method="get"><label>Search<input name="q" value="${escape(filter.q ?? '')}"></label><label>Tag<input name="tag" value="${escape(filter.tag ?? '')}"></label><button>Filter</button></form><nav>Tags: ${store.listTags().map(t=>`<a href="/?tag=${encodeURIComponent(t.name)}">${escape(t.name)} (${t.count})</a>`).join(' · ')}</nav>${noteForm()}<h2>Notes</h2>${notes.length ? notes.map(n=>`<article><pre>${escape(n.text)}</pre><p class="tags">${n.tags.map(escape).join(', ')}</p><small>${escape(n.updatedAt)}</small> <a href="/notes/${n.id}/edit">Edit</a><form method="post" action="/notes/${n.id}/delete"><button>Delete</button></form></article>`).join('') : '<p>No notes found.</p>'}<nav>${page>1 ? `<a href="${pageUrl(page-1)}">Previous</a>` : ''} Page ${page} ${next ? `<a href="${pageUrl(page+1)}">Next</a>` : ''}</nav>`);return;
    }
    if (match && !match[1]) {
      const id=Number(match[2]);
      const note=store.getNote(id); if (!note) notFound();
      if (req.method==='GET' && match[3]==='edit') {html(res,`<h2>Edit note</h2>${noteForm(note)}`);return;}
      if (req.method==='POST' && (!match[3] || match[3]==='delete')) {
        if (match[3]==='delete') store.deleteNote(id);
        else store.updateNote(id,await body(req,false));
        res.writeHead(303,{Location:'/'});res.end();return;
      }
    }
    if (path==='/notes' && req.method==='POST') {
      const data=await body(req,false);store.createNote(data.text,data.tags);
      res.writeHead(303,{Location:'/'});res.end();return;
    }
    notFound();
  } catch(error) {
    const status=error.status ?? 400;
    if (api) json(res,{error:error.message},status);
    else html(res,`<p class="error" role="alert">${escape(error.message)}</p><a href="/">Back to notes</a>`,status);
  }
});
server.listen(port,'127.0.0.1',()=>console.log(JSON.stringify({port:server.address().port})));
for (const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>server.close(()=>{store.close();}));
