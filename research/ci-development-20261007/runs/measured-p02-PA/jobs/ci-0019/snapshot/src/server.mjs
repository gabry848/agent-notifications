import http from 'node:http';
import {searchRecords} from './search.mjs';
import {planDependencies} from './graph.mjs';
import {exportCSV,importCSV,exportNDJSON,importNDJSON} from './transfer.mjs';
const MAX_BODY=1024*1024;
async function body(req) {
  let size=0;const parts=[];
  for await(const chunk of req) {size+=chunk.length;if(size>MAX_BODY) throw Object.assign(Error('request body too large'),{status:413});parts.push(chunk);}
  return Buffer.concat(parts).toString('utf8');
}
export function createServer(catalog) {
  return http.createServer((req,res)=> {
    const json=(status,value)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
    const notFound=()=>{throw Object.assign(Error('not found'),{status:404});};
    async function handle() {
      const url=new URL(req.url,'http://localhost');const path=url.pathname,method=req.method;
      if(method==='GET' && path==='/health') return json(200,{ok:true});
      if(method==='GET' && path==='/records') {
        const query={};
        for(const key of ['text','versionMin','versionMax','sortBy','order']) if(url.searchParams.has(key)) query[key]=url.searchParams.get(key);
        if(url.searchParams.has('tags')) query.tags=url.searchParams.get('tags').split(',');
        for(const key of ['offset','limit']) if(url.searchParams.has(key)) {
          const value=url.searchParams.get(key);if(!/^\d+$/.test(value)) throw Error('invalid '+key);query[key]=Number(value);
        }
        return json(200,searchRecords(catalog.list(),query));
      }
      if(method==='POST' && path==='/records') return json(201,catalog.add(JSON.parse(await body(req))));
      if(path.startsWith('/records/') && ['GET','PATCH','DELETE'].includes(method)) {
        const id=decodeURIComponent(path.slice('/records/'.length));const record=catalog.get(id);if(!record) notFound();
        if(method==='GET') return json(200,record);
        if(method==='PATCH') return json(200,catalog.update(id,JSON.parse(await body(req))));
        catalog.remove(id);res.writeHead(204);return res.end();
      }
      if(method==='GET' && path==='/plan') return json(200,{ids:planDependencies(catalog.list(),(url.searchParams.get('ids')??'').split(',').filter(Boolean))});
      if(method==='GET' && path==='/export.csv') {res.writeHead(200,{'content-type':'text/csv; charset=utf-8'});return res.end(exportCSV(catalog.list()));}
      if(method==='POST' && path==='/import.csv') return json(201,{added:importCSV(await body(req),catalog).length});
      if(method==='POST' && path==='/import.ndjson') {
        const text=await body(req);return json(201,{added:(await importNDJSON([text],catalog)).length});
      }
      if(method==='GET' && path==='/export.ndjson') {
        res.writeHead(200,{'content-type':'application/x-ndjson'});
        for await(const line of exportNDJSON(catalog.list())) res.write(line);
        return res.end();
      }
      notFound();
    }
    handle().catch(error=> {
      if(res.headersSent) {res.end();return;}
      json(error.status??(/^duplicate id:/.test(error.message)?409:400),{error:error.message});
    });
  });
}
