import http from 'node:http';
import {once} from 'node:events';
import {searchRecords} from './search.mjs';
import {planDependencies} from './graph.mjs';
import {exportCSV,importCSV,exportNDJSON,importNDJSON} from './transfer.mjs';
const maximum=1024*1024;
async function readBody(req) {
  const chunks=[];let size=0;
  for await(const chunk of req) {
    size+=chunk.length;
    if(size>maximum) {const e=Error('request body exceeds 1 MiB');e.status=413;throw e;}
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}
export function createServer(catalog) {
  return http.createServer((req,res)=>{
    const json=(status,data)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(data));};
    const text=(type,data)=>{res.writeHead(200,{'content-type':type});res.end(data);};
    (async()=>{
      const url=new URL(req.url,'http://localhost'), path=url.pathname, method=req.method;
      if(method==='GET' && path==='/health') return json(200,{ok:true});
      if(method==='GET' && path==='/records') {
        const query={};
        for(const key of ['text','versionMin','versionMax','sortBy','order']) if(url.searchParams.has(key)) query[key]=url.searchParams.get(key);
        if(url.searchParams.has('tags')) query.tags=url.searchParams.get('tags').split(',');
        for(const key of ['offset','limit']) if(url.searchParams.has(key)) {
          const raw=url.searchParams.get(key);if(!/^[0-9]+$/.test(raw)) throw Error('invalid paging');query[key]=Number(raw);
        }
        return json(200,searchRecords(catalog.list(),query));
      }
      if(method==='POST' && path==='/records') {
        const body=JSON.parse(await readBody(req));
        try {return json(201,catalog.add(body));} catch(e) {if(e.message.startsWith('duplicate id:')) e.status=409;throw e;}
      }
      const match=/^\/records\/([^/]+)$/.exec(path);
      if(match && ['GET','PATCH','DELETE'].includes(method)) {
        const id=decodeURIComponent(match[1]);
        if(!catalog.get(id)) return json(404,{error:'unknown id'});
        if(method==='GET') return json(200,catalog.get(id));
        if(method==='PATCH') return json(200,catalog.update(id,JSON.parse(await readBody(req))));
        catalog.remove(id);res.writeHead(204);return res.end();
      }
      if(method==='GET' && path==='/plan') return json(200,{ids:planDependencies(catalog.list(),url.searchParams.get('ids')?.split(',').filter(Boolean)??[])});
      if(method==='GET' && path==='/export.csv') return text('text/csv',exportCSV(catalog.list()));
      if(method==='POST' && path==='/import.csv') return json(201,{added:importCSV(await readBody(req),catalog).length});
      if(method==='POST' && path==='/import.ndjson') {
        const body=await readBody(req);
        return json(201,{added:(await importNDJSON([body],catalog)).length});
      }
      if(method==='GET' && path==='/export.ndjson') {
        res.writeHead(200,{'content-type':'application/x-ndjson'});
        for await(const line of exportNDJSON(catalog.list())) if(!res.write(line)) await once(res,'drain');
        return res.end();
      }
      return json(404,{error:'unknown route'});
    })().catch(e=>{if(!res.headersSent) json(e.status??400,{error:e.message});else res.destroy();});
  });
}
