import { createServer } from 'node:http';
import { openStore } from './store.mjs';
import { importNotes, exportNotes } from './import.mjs';

const args=process.argv.slice(2);
const option=(key,fallback)=>args.includes(key)?args[args.indexOf(key)+1]:fallback;
const store=openStore(option('--db','data/notes.sqlite'));
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const layout=(title,body)=>`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escape(title)}</title><style>body{font:16px system-ui;max-width:850px;margin:2rem auto;padding:0 1rem;background:#f5f7fa;color:#172333}article,form.panel{background:white;padding:1rem;margin:1rem 0;border-radius:8px}textarea{display:block;width:95%;min-height:100px}input,button{padding:.5rem;margin:.3rem}a{color:#145eae}.tags{color:#536478}.error{color:#a00}pre{white-space:pre-wrap;font:inherit}</style></head><body><h1><a href="/">Quick Notes</a></h1>${body}</body></html>`;
const form=(note={text:'',tags:[]},action='/notes')=>`<form class="panel" method="post" action="${action}"><label>Text<textarea name="text" required maxlength="4000">${escape(note.text)}</textarea></label><label>Tags (comma separated)<input name="tags" value="${escape(note.tags.join(', '))}"></label><button>Save note</button></form>`;
const formTags=value=>String(value??'').split(',').map(t=>t.trim()).filter(Boolean);
async function body(req) {
  let text='';
  for await(const chunk of req) {text+=chunk; if(Buffer.byteLength(text)>1024*1024) throw new Error('Request too large');}
  if(req.headers['content-type']?.includes('application/json')) {
    const value=JSON.parse(text);
    if(!value || typeof value!=='object' || Array.isArray(value)) throw new Error('Body must be an object');
    return value;
  }
  return Object.fromEntries(new URLSearchParams(text));
}
function filters(url) {
  const result={};
  for(const key of ['q','tag']) if(url.searchParams.has(key)) result[key]=url.searchParams.get(key);
  for(const key of ['limit','offset']) if(url.searchParams.has(key)) {
    const value=url.searchParams.get(key);
    if(!/^\d+$/.test(value)) throw new Error(`${key} must be an integer`);
    result[key]=Number(value);
  }
  return result;
}
const server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  const api=url.pathname.startsWith('/api/');
  const json=(value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));};
  const html=(value,status=200)=>{res.writeHead(status,{'Content-Type':'text/html; charset=utf-8'});res.end(value);};
  const missing=()=>{if(api) json({error:'Not found'},404);else html(layout('Not found','<p>Not found</p>'),404);};
  const redirect=()=>{res.writeHead(303,{Location:'/'});res.end();};
  try {
    const path=url.pathname, method=req.method;
    if(path==='/api/notes') {
      if(method==='GET') return json(store.listNotes(filters(url)));
      if(method==='POST') {const a=await body(req);return json(store.createNote(a.text,a.tags),201);}
    }
    const single=path.match(/^\/api\/notes\/([1-9]\d*)$/);
    if(single) {
      const id=Number(single[1]);
      if(!store.getNote(id)) return missing();
      if(method==='GET') return json(store.getNote(id));
      if(method==='PATCH') return json(store.updateNote(id,await body(req)));
      if(method==='DELETE') return json(store.deleteNote(id));
    }
    if(path==='/api/tags' && method==='GET') return json(store.listTags());
    if(path==='/api/export' && method==='GET') return json(exportNotes(store));
    if(path==='/api/import' && method==='POST') return json(importNotes(store,(await body(req)).notes),201);
    if(path==='/' && method==='GET') {
      const q=url.searchParams.get('q')??'',tag=url.searchParams.get('tag')??'';
      const raw=url.searchParams.get('page')??'1';
      if(!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw)<1) throw new Error('page must be a positive integer');
      const page=Number(raw),offset=(page-1)*20;
      const f={q,...(tag?{tag}:{}),limit:20,offset};
      const notes=store.listNotes(f);
      const pageLink=n=>`/?${new URLSearchParams({q,tag,page:String(n)})}`;
      const counts=store.listTags().map(t=>`<a href="/?${escape(new URLSearchParams({tag:t.name}).toString())}">${escape(t.name)} (${t.count})</a>`).join(' · ');
      return html(layout('Quick Notes',`<form method="get"><label>Search <input name="q" value="${escape(q)}"></label><label>Tag <input name="tag" value="${escape(tag)}"></label><button>Filter</button></form><nav>${counts}</nav><h2>Create note</h2>${form()}<h2>Notes</h2>${notes.map(n=>`<article><pre>${escape(n.text)}</pre><p class="tags">${n.tags.map(escape).join(', ')}</p><small>${escape(n.updatedAt)}</small> <a href="/notes/${n.id}/edit">Edit</a><form method="post" action="/notes/${n.id}/delete"><button>Delete</button></form></article>`).join('')||'<p>No notes found.</p>'}<nav>${page>1?`<a href="${escape(pageLink(page-1))}">Previous</a>`:''} <span>Page ${page}</span> ${store.listNotes({...f,limit:1,offset:offset+20}).length?`<a href="${escape(pageLink(page+1))}">Next</a>`:''}</nav>`));
    }
    if(path==='/notes' && method==='POST') {const a=await body(req);store.createNote(a.text,formTags(a.tags));return redirect();}
    const route=path.match(/^\/notes\/([1-9]\d*)(\/edit|\/delete)?$/);
    if(route) {
      const id=Number(route[1]),note=store.getNote(id);
      if(!note) return missing();
      if(method==='GET' && route[2]==='/edit') return html(layout('Edit note',`<h2>Edit note</h2>${form(note,`/notes/${id}`)}`));
      if(method==='POST' && route[2]==='/delete') {store.deleteNote(id);return redirect();}
      if(method==='POST' && !route[2]) {const a=await body(req);store.updateNote(id,{text:a.text,tags:formTags(a.tags)});return redirect();}
    }
    missing();
  } catch(error) {
    if(api) json({error:error.message},400);
    else html(layout('Validation error',`<h2 class="error">Validation error</h2><p class="error">${escape(error.message)}</p><p><a href="/">Return to notes</a></p>`),400);
  }
});
server.listen(Number(option('--port','8080')),'127.0.0.1',()=>console.log(JSON.stringify({port:server.address().port})));
for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>server.close(()=>{store.close();process.exit(0);}));
