import {createServer} from 'node:http';
import {openStore} from './store.mjs';
import {importNotes, exportNotes} from './import.mjs';

const args = process.argv.slice(2);
const option = (name,fallback) => args.includes(name) ? args[args.indexOf(name)+1] : fallback;
const store = openStore(option('--db','data/notes.sqlite'));
const escape = value => String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const httpError = (status,message) => Object.assign(new Error(message),{status});
const json = (res,value,status=200) => { res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'}); res.end(JSON.stringify(value)); };
const html = (res,body,status=200) => {
  res.writeHead(status,{'Content-Type':'text/html; charset=utf-8'});
  res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Quick Notes</title><style>
  body{font:16px system-ui;max-width:850px;margin:2rem auto;padding:0 1rem;background:#f5f7fa;color:#182230}article,section{background:white;padding:1rem;margin:1rem 0;border:1px solid #d9dfe8;border-radius:8px}textarea{width:100%;box-sizing:border-box;min-height:100px}input,button,textarea{font:inherit;padding:.5rem;margin:.25rem 0}button{cursor:pointer}a{color:#245eb1}.text{white-space:pre-wrap;overflow-wrap:anywhere}.tag{display:inline-block;background:#e9eef9;padding:.2rem .5rem;margin:.2rem;border-radius:4px}.error{color:#a01919}label{display:block}nav{display:flex;gap:1rem}small{color:#556}
  </style></head><body><h1><a href="/">Quick Notes</a></h1>${body}</body></html>`);
};
const form = (note={text:'',tags:[]}) => `<form method="post" action="${note.id ? '/notes/'+note.id : '/notes'}"><label>Text<textarea name="text" maxlength="4000" required>${escape(note.text)}</textarea></label><label>Tags (comma separated)<input name="tags" value="${escape(note.tags.join(', '))}"></label><button>${note.id ? 'Save changes' : 'Create note'}</button></form>`;
const tagLink = name => `<a class="tag" href="/?tag=${escape(encodeURIComponent(name))}">${escape(name)}</a>`;
function collectionOptions(params) {
  const result={};
  for (const key of ['q','tag']) if (params.has(key)) result[key]=params.get(key);
  for (const key of ['limit','offset']) if (params.has(key)) {
    if (!/^\d+$/.test(params.get(key))) throw new Error(`${key} must be an integer`);
    result[key]=Number(params.get(key));
  }
  return result;
}
function dashboard(res,params) {
  const pageText=params.get('page') ?? '1';
  if (!/^\d+$/.test(pageText) || !Number.isSafeInteger(Number(pageText)) || Number(pageText)<1) throw new Error('Page must be a positive integer');
  const page=Number(pageText), filters={};
  for (const key of ['q','tag']) if (params.has(key) && (key !== 'tag' || params.get(key).trim())) filters[key]=params.get(key);
  const notes=store.listNotes({...filters,limit:20,offset:(page-1)*20});
  const more=store.listNotes({...filters,limit:1,offset:page*20}).length>0;
  const pageLink = n => { const p=new URLSearchParams(filters); p.set('page',String(n)); return '/?'+escape(p.toString()); };
  html(res,`<section><h2>New note</h2>${form()}</section>
    <section><h2>Search</h2><form method="get" action="/"><label>Search text <input name="q" value="${escape(filters.q ?? '')}"></label><label>Tag <input name="tag" value="${escape(filters.tag ?? '')}"></label><button>Filter</button> <a href="/">Clear</a></form>
    <div>${store.listTags().map(({name,count})=>`${tagLink(name)} (${count})`).join(' ')}</div></section>
    <h2>Notes</h2>${notes.length ? notes.map(note=>`<article><div class="text">${escape(note.text)}</div><div>${note.tags.map(tagLink).join(' ')}</div><small>#${note.id} · ${escape(note.updatedAt)}</small><p><a href="/notes/${note.id}/edit">Edit</a></p><form method="post" action="/notes/${note.id}/delete"><button>Delete</button></form></article>`).join('') : '<p>No notes found.</p>'}
    <nav>${page>1 ? `<a href="${pageLink(page-1)}">Previous</a>` : ''}<span>Page ${page}</span>${more ? `<a href="${pageLink(page+1)}">Next</a>` : ''}</nav>`);
}
async function body(req,asJson) {
  const chunks=[];
  let size=0;
  for await (const chunk of req) {
    size+=chunk.length;
    if (size>2*1024*1024) throw new Error('Request body too large');
    chunks.push(chunk);
  }
  const text=Buffer.concat(chunks).toString('utf8');
  if (asJson) {
    let value;
    try { value=JSON.parse(text); } catch { throw new Error('Invalid JSON body'); }
    if (!value || typeof value!=='object' || Array.isArray(value)) throw new Error('Body must be an object');
    return value;
  }
  const fields=new URLSearchParams(text);
  return {text:fields.get('text'),tags:(fields.get('tags') ?? '').split(',').map(tag=>tag.trim()).filter(Boolean)};
}
const redirect = res => {res.writeHead(303,{Location:'/'});res.end();};
const requireNote = id => { const note=store.getNote(id); if (!note) throw httpError(404,'Note not found'); return note; };
const server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  const path=url.pathname, api=path.startsWith('/api/');
  try {
    if (req.method==='GET' && path==='/') return dashboard(res,url.searchParams);
    if (path==='/api/notes') {
      if (req.method==='GET') return json(res,store.listNotes(collectionOptions(url.searchParams)));
      if (req.method==='POST') {const value=await body(req,true);return json(res,store.createNote(value.text,value.tags),201);}
    }
    if (req.method==='GET' && path==='/api/tags') return json(res,store.listTags());
    if (req.method==='GET' && path==='/api/export') return json(res,exportNotes(store));
    if (req.method==='POST' && path==='/api/import') return json(res,importNotes(store,(await body(req,true)).notes),201);
    const apiNote=path.match(/^\/api\/notes\/(\d+)$/);
    if (apiNote) {
      const id=Number(apiNote[1]); requireNote(id);
      if (req.method==='GET') return json(res,store.getNote(id));
      if (req.method==='PATCH') return json(res,store.updateNote(id,await body(req,true)));
      if (req.method==='DELETE') return json(res,store.deleteNote(id));
    }
    if (req.method==='POST' && path==='/notes') {
      const value=await body(req,false); store.createNote(value.text,value.tags); return redirect(res);
    }
    const formNote=path.match(/^\/notes\/(\d+)(\/edit|\/delete)?$/);
    if (formNote) {
      const id=Number(formNote[1]), note=requireNote(id);
      if (req.method==='GET' && formNote[2]==='/edit') return html(res,`<h2>Edit note</h2>${form(note)}<a href="/">Cancel</a>`);
      if (req.method==='POST' && formNote[2]==='/delete') {store.deleteNote(id);return redirect(res);}
      if (req.method==='POST' && !formNote[2]) {store.updateNote(id,await body(req,false));return redirect(res);}
    }
    throw httpError(404,'Not found');
  } catch(error) {
    const status=error.status ?? 400;
    if (api) json(res,{error:error.message},status);
    else html(res,`<h2 class="error">${escape(error.message)}</h2><p><a href="/">Back to notes</a></p>`,status);
  }
});
server.listen(Number(option('--port','8080')),'127.0.0.1',()=>console.log(JSON.stringify({port:server.address().port})));
for (const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>server.close(()=>{store.close();process.exit(0);}));
