import http from 'node:http';
import {searchRecords} from './search.mjs';
import {planDependencies} from './graph.mjs';
import {exportCSV,importCSV,exportNDJSON,importNDJSON} from './transfer.mjs';
const MAX_BODY=1024*1024;
function failure(status,message) {return Object.assign(Error(message),{status});}
async function body(req) {
  let size=0;const chunks=[];
  for await(const chunk of req) {
    size+=chunk.length;
    if(size>MAX_BODY) throw failure(413,'request body exceeds 1 MiB');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
export function createServer(catalog) {
  return http.createServer((req,res)=>{
    const json=(status,value)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
    async function handle() {
      const url=new URL(req.url,'http://localhost'),path=url.pathname,method=req.method;
      if(method==='GET' && path==='/health') return json(200,{ok:true});
      if(method==='GET' && path==='/records') {
        const query={};
        for(const key of ['text','versionMin','versionMax','sortBy','order']) if(url.searchParams.has(key)) query[key]=url.searchParams.get(key);
        if(url.searchParams.has('tags')) query.tags=url.searchParams.get('tags').split(',');
        for(const key of ['offset','limit']) if(url.searchParams.has(key)) {
          const value=url.searchParams.get(key);
          if(!/^\d+$/.test(value)) throw Error('invalid '+key);
          query[key]=Number(value);
        }
        return json(200,searchRecords(catalog.list(),query));
      }
      if(method==='POST' && path==='/records') {
        const record=JSON.parse((await body(req)).toString('utf8'));
        try {return json(201,catalog.add(record));}
        catch(error) {if(error.message.startsWith('duplicate id:')) error.status=409;throw error;}
      }
      const match=/^\/records\/([^/]+)$/.exec(path);
      if(match && ['GET','PATCH','DELETE'].includes(method)) {
        const id=decodeURIComponent(match[1]);
        if(!catalog.get(id)) throw failure(404,'unknown id: '+id);
        if(method==='GET') return json(200,catalog.get(id));
        if(method==='PATCH') return json(200,catalog.update(id,JSON.parse((await body(req)).toString('utf8'))));
        catalog.remove(id);res.writeHead(204);return res.end();
      }
      if(method==='GET' && path==='/plan') return json(200,{ids:planDependencies(catalog.list(),(url.searchParams.get('ids')||'').split(',').filter(Boolean))});
      if(method==='GET' && path==='/export.csv') {res.writeHead(200,{'content-type':'text/csv'});return res.end(exportCSV(catalog.list()));}
      if(method==='GET' && path==='/export.ndjson') {
        res.writeHead(200,{'content-type':'application/x-ndjson'});
        for await(const line of exportNDJSON(catalog.list())) res.write(line);
        return res.end();
      }
      if(method==='POST' && path==='/import.csv') return json(201,{added:importCSV((await body(req)).toString('utf8'),catalog).length});
      if(method==='POST' && path==='/import.ndjson') return json(201,{added:(await importNDJSON([await body(req)],catalog)).length});
      throw failure(404,'unknown route');
    }
    handle().catch(error=>{
      if(!res.headersSent && !res.destroyed) json(error.status??400,{error:error.message});
      else if(!res.destroyed) res.end();
    });
  });
}
