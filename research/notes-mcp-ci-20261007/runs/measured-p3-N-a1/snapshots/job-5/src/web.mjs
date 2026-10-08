import { createServer } from 'node:http';
import { parseArgs } from 'node:util';
import { openStore } from './store.mjs';
import { exportNotes } from './service.mjs';
import { importNotes } from './import.mjs';

const {values}=parseArgs({options:{db:{type:'string',default:'data/notes.sqlite'},port:{type:'string',default:'8080'}}});
const port=Number(values.port);
if (!Number.isInteger(port) || port<0 || port>65535) throw new Error('Invalid port');
const store=openStore(values.db);
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const layout=(body)=>`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Quick Notes</title><style>body{font:16px system-ui;max-width:850px;margin:2rem auto;padding:0 1rem;background:#f5f7fa;color:#172638}article,section{background:white;padding:1rem;margin:1rem 0;border-radius:8px}textarea{width:95%;min-height:90px}input,button,select{padding:.5rem;margin:.25rem}pre{white-space:pre-wrap;font:inherit}.tags{color:#476781}.error{color:#a20e22}nav a{margin-right:1rem}</style></head><body><h1><a href="/">Quick Notes</a></h1>${body}</body></html>`;
const noteForm=(note={})=>`<form method="post" action="${note.id?'/notes/'+note.id:'/notes'}"><label>Text<br><textarea name="text" maxlength="4000" required>${escape(note.text)}</textarea></label><br><label>Tags (comma separated) <input name="tags" value="${escape(Array.isArray(note.tags)?note.tags.join(', '):note.tags)}"></label><button>Save note</button></form>`;
const fail=(status,message)=>{const error=new Error(message);error.status=status;throw error;};
const numberParam=(params,name,fallback)=>params.has(name)?Number(params.get(name)):fallback;
async function body(req,json) {
  let text='';
  for await (const chunk of req) { text+=chunk; if (Buffer.byteLength(text)>1024*1024) fail(400,'Request too large'); }
  if (json) {
    let value; try { value=JSON.parse(text); } catch { fail(400,'Invalid JSON'); }
    if (!value || typeof value!=='object' || Array.isArray(value)) fail(400,'Expected a JSON object');
    return value;
  }
  return Object.fromEntries(new URLSearchParams(text));
}
const formTags=value=>value?value.split(',').map(s=>s.trim()).filter(Boolean):[];
const server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  const path=url.pathname, method=req.method, api=path.startsWith('/api/');
  const send=(value,status=200)=>{res.writeHead(status,{'Content-Type':api?'application/json; charset=utf-8':'text/html; charset=utf-8'});res.end(api?JSON.stringify(value):layout(value));};
  const redirect=()=>{res.writeHead(303,{Location:'/'});res.end();};
  let submitted;
  try {
    if (api) {
      if (path==='/api/notes' && method==='GET') {
        const p=url.searchParams;
        send(store.listNotes({q:p.has('q')?p.get('q'):undefined,tag:p.has('tag')?p.get('tag'):undefined,limit:numberParam(p,'limit',50),offset:numberParam(p,'offset',0)}));return;
      }
      if (path==='/api/notes' && method==='POST') { const b=await body(req,true);send(store.createNote(b.text,b.tags),201);return; }
      if (path==='/api/tags' && method==='GET') {send(store.listTags());return;}
      if (path==='/api/export' && method==='GET') {send(exportNotes(store));return;}
      if (path==='/api/import' && method==='POST') {const b=await body(req,true);send(importNotes(store,b.notes),201);return;}
      const match=path.match(/^\/api\/notes\/(\d+)$/);
      if (match && ['GET','PATCH','DELETE'].includes(method)) {
        const id=Number(match[1]);
        if (!store.getNote(id)) fail(404,'Note not found');
        if (method==='GET') send(store.getNote(id));
        if (method==='PATCH') send(store.updateNote(id,await body(req,true)));
        if (method==='DELETE') send(store.deleteNote(id));
        return;
      }
      fail(404,'Route not found');
    }
    if (path==='/' && method==='GET') {
      const p=url.searchParams,q=p.get('q')??'',tag=p.get('tag')??'',page=numberParam(p,'page',1);
      if (!Number.isSafeInteger(page) || page<1 || !Number.isSafeInteger(page*20)) fail(400,'Invalid page');
      const options={q,tag:tag||undefined,limit:20,offset:(page-1)*20};
      const notes=store.listNotes(options),hasNext=store.listNotes({...options,limit:1,offset:page*20}).length>0;
      const link=page=>'?'+escape(new URLSearchParams({q,tag,page:String(page)}).toString());
      send(`<section><h2>New note</h2>${noteForm()}</section><section><form method="get"><label>Search <input name="q" value="${escape(q)}"></label><label>Tag <input name="tag" value="${escape(tag)}"></label><button>Filter</button></form><nav>${store.listTags().map(t=>`<a href="/?${escape(new URLSearchParams({tag:t.name}).toString())}">${escape(t.name)} (${t.count})</a>`).join(' ')}</nav></section><h2>Notes</h2>${notes.length?notes.map(n=>`<article><pre>${escape(n.text)}</pre><p class="tags">${n.tags.map(escape).join(', ')}</p><small>${escape(n.updatedAt)}</small><p><a href="/notes/${n.id}/edit">Edit</a></p><form method="post" action="/notes/${n.id}/delete"><button>Delete</button></form></article>`).join(''):'<p>No notes found.</p>'}<nav>${page>1?`<a href="/${link(page-1)}">Previous</a>`:''}Page ${page} ${hasNext?`<a href="/${link(page+1)}">Next</a>`:''}</nav>`);return;
    }
    const edit=path.match(/^\/notes\/(\d+)\/edit$/);
    if (edit && method==='GET') {const note=store.getNote(Number(edit[1]));if (!note) fail(404,'Note not found');send(`<h2>Edit note</h2>${noteForm(note)}`);return;}
    const update=path.match(/^\/notes\/(\d+)(\/delete)?$/);
    if (method==='POST' && (path==='/notes' || update)) {
      const id=update?Number(update[1]):undefined;
      if (id && !store.getNote(id)) fail(404,'Note not found');
      if (update?.[2]) store.deleteNote(id);
      else {
        submitted=await body(req,false);submitted.id=id;
        const tags=formTags(submitted.tags);
        if (id) store.updateNote(id,{text:submitted.text,tags});
        else store.createNote(submitted.text,tags);
      }
      redirect();return;
    }
    fail(404,'Route not found');
  } catch(error) {
    send(api?{error:error.message}:`<p class="error" role="alert">${escape(error.message)}</p>${submitted?noteForm(submitted):'<a href="/">Back to notes</a>'}`,error.status??400);
  }
});
server.listen(port,'127.0.0.1',()=>console.log(JSON.stringify({port:server.address().port})));
const shutdown=()=>server.close(()=>{store.close();});
process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
