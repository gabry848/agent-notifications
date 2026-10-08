import {createServer} from 'node:http';
import {parseArgs} from 'node:util';
import {openStore} from './store.mjs';
const {values}=parseArgs({options:{db:{type:'string',default:'data/notes.sqlite'},port:{type:'string',default:'8080'}}});
const port=Number(values.port);
if (!Number.isInteger(port)||port<0||port>65535) throw new Error('Invalid port');
const store=openStore(values.db);
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const layout=(body)=>`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Quick Notes</title><style>body{max-width:850px;margin:2rem auto;padding:0 1rem;font:16px system-ui;background:#f8fafc;color:#182338}article,form{background:white;padding:1rem;margin:1rem 0;border:1px solid #ccd5e0;border-radius:8px}textarea{width:95%;min-height:100px}input,button{padding:.5rem;margin:.25rem}pre{white-space:pre-wrap;font:inherit}.error{color:#a11}a{color:#175ca0}.tag{margin-right:.5rem}</style></head><body><h1><a href="/">Quick Notes</a></h1>${body}</body></html>`;
const noteForm=(note={text:'',tags:[]},error='')=>`<h2>${note.id?'Edit note':'Create note'}</h2>${error?`<p class="error" role="alert">${escape(error)}</p>`:''}<form method="post" action="/notes${note.id?'/'+note.id:''}"><label>Text<br><textarea name="text" required maxlength="4000">${escape(note.text)}</textarea></label><br><label>Tags (comma separated) <input name="tags" value="${escape(note.tags.join(', '))}"></label><button type="submit">Save</button></form>`;
function dashboard(url,error='',draft) {
  const q=url.searchParams.get('q')??'',tag=url.searchParams.get('tag')??'';
  const page=Number(url.searchParams.get('page')??1);
  if (!Number.isSafeInteger(page)||page<1||!Number.isSafeInteger(page*20)) throw new Error('Page must be a positive integer');
  const filters={q,...(tag?{tag}:{}),limit:20,offset:(page-1)*20};
  const notes=store.listNotes(filters);
  const link=p=>'/?'+new URLSearchParams({q,tag,page:String(p)});
  return layout(`<form method="get" action="/"><label>Search <input name="q" value="${escape(q)}"></label><label>Tag <input name="tag" value="${escape(tag)}"></label><button>Filter</button></form><nav>${store.listTags().map(t=>`<a class="tag" href="/?${escape(new URLSearchParams({tag:t.name}))}">${escape(t.name)} (${t.count})</a>`).join('')}</nav>${noteForm(draft,error)}<h2>Notes</h2>${notes.map(n=>`<article><pre>${escape(n.text)}</pre><p>${n.tags.map(t=>`<span class="tag">${escape(t)}</span>`).join('')}</p><small>${escape(n.updatedAt)}</small> <a href="/notes/${n.id}/edit">Edit</a><form method="post" action="/notes/${n.id}/delete"><button>Delete</button></form></article>`).join('')||'<p>No notes found.</p>'}<nav>${page>1?`<a href="${escape(link(page-1))}">Previous</a>`:''} <span>Page ${page}</span> ${store.listNotes({...filters,offset:page*20,limit:1}).length?`<a href="${escape(link(page+1))}">Next</a>`:''}</nav>`);
}
async function body(req,json) {
  let text='';
  for await (const chunk of req) {text+=chunk; if (Buffer.byteLength(text)>1024*1024) throw new Error('Request body too large');}
  if (json) {const data=JSON.parse(text);if (!data || typeof data!=='object' || Array.isArray(data)) throw new Error('Body must be an object');return data;}
  const form=new URLSearchParams(text);
  return {text:form.get('text')??'',tags:(form.get('tags')??'').split(',').map(t=>t.trim()).filter(Boolean)};
}
const server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  const api=url.pathname.startsWith('/api/');
  const send=(status,value)=>{res.writeHead(status,{'Content-Type':api?'application/json; charset=utf-8':'text/html; charset=utf-8'});res.end(api?JSON.stringify(value):value);};
  const redirect=()=>{res.writeHead(303,{Location:'/'});res.end();};
  const missing=()=>send(404,api?{error:'Note not found'}:layout('<h2>Not found</h2>'));
  let draft;
  try {
    if (api) {
      if (url.pathname==='/api/notes') {
        if (req.method==='GET') {
          const options={};for (const key of ['q','tag']) if(url.searchParams.has(key)) options[key]=url.searchParams.get(key);
          for (const key of ['limit','offset']) if(url.searchParams.has(key)) options[key]=Number(url.searchParams.get(key));
          return send(200,store.listNotes(options));
        }
        if (req.method==='POST') {const data=await body(req,true);return send(201,store.createNote(data.text,data.tags));}
      }
      const match=url.pathname.match(/^\/api\/notes\/(\d+)$/);
      if(match) {
        const id=Number(match[1]);
        if(req.method==='GET') {const note=store.getNote(id);return note?send(200,note):missing();}
        if(req.method==='PATCH') {const note=store.updateNote(id,await body(req,true));return note?send(200,note):missing();}
        if(req.method==='DELETE') return store.deleteNote(id)?send(200,{deleted:true}):missing();
      }
      if(req.method==='GET'&&url.pathname==='/api/tags') return send(200,store.listTags());
      if(req.method==='GET'&&url.pathname==='/api/export') return send(200,store.exportNotes());
      if(req.method==='POST'&&url.pathname==='/api/import') {const data=await body(req,true);return send(200,store.importNotes(data.notes));}
      return missing();
    }
    if(req.method==='GET'&&url.pathname==='/') return send(200,dashboard(url));
    const edit=url.pathname.match(/^\/notes\/(\d+)\/edit$/);
    if(req.method==='GET'&&edit) {const note=store.getNote(Number(edit[1]));return note?send(200,layout(noteForm(note))):missing();}
    if(req.method==='POST'&&url.pathname==='/notes') {draft=await body(req,false);store.createNote(draft.text,draft.tags);return redirect();}
    const action=url.pathname.match(/^\/notes\/(\d+)(\/delete)?$/);
    if(req.method==='POST'&&action) {
      const id=Number(action[1]);
      if(action[2]) {if(!store.deleteNote(id)) return missing();}
      else {draft={...await body(req,false),id};if(!store.updateNote(id,draft)) return missing();}
      return redirect();
    }
    return missing();
  } catch(error) {
    if(api) return send(400,{error:error.message});
    return send(400,layout(noteForm(draft,error.message)));
  }
});
server.listen(port,'127.0.0.1',()=>console.log(JSON.stringify({port:server.address().port})));
function shutdown() {server.close(()=>store.close());}
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
