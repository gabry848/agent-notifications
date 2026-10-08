import http from 'node:http';
import {once} from 'node:events';
import {pathToFileURL} from 'node:url';
import {createCatalog} from './catalog.mjs';
import {searchRecords} from './search.mjs';
import {planDependencies} from './graph.mjs';
import {exportCSV,importCSV,exportNDJSON,importNDJSON} from './transfer.mjs';
const MAX=1024*1024;
function fail(status,message) {const e=Error(message);e.status=status;throw e;}
export function createServer(catalog) {
  return http.createServer((req,res)=>{
    const json=(status,value)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
    async function handle() {
      const url=new URL(req.url,'http://localhost'),path=url.pathname,method=req.method;
      // Read without destroying the request stream on oversize, so a 413 can be delivered.
      let data;
      if(['POST','PATCH'].includes(method)) {
        const chunks=[];let size=0,oversize=false;
        for await(const chunk of req) {size+=chunk.length;if(size>MAX) oversize=true;else chunks.push(chunk);}
        if(oversize) fail(413,'request body too large');data=Buffer.concat(chunks);
      }
      if(method==='GET' && path==='/health') return json(200,{ok:true});
      if(path==='/records') {
        if(method==='GET') {
          const q=Object.fromEntries(url.searchParams);
          if(q.tags!==undefined) q.tags=q.tags.split(',');
          for(const key of ['offset','limit']) if(q[key]!==undefined) {if(!/^\d+$/.test(q[key])) fail(400,'invalid paging');q[key]=Number(q[key]);}
          return json(200,searchRecords(catalog.list(),q));
        }
        if(method==='POST') return json(201,catalog.add(JSON.parse(data.toString('utf8'))));
      }
      const match=path.match(/^\/records\/([^/]+)$/);
      if(match && ['GET','PATCH','DELETE'].includes(method)) {
        const id=decodeURIComponent(match[1]);if(!catalog.get(id)) fail(404,'unknown id: '+id);
        if(method==='GET') return json(200,catalog.get(id));
        if(method==='PATCH') return json(200,catalog.update(id,JSON.parse(data.toString('utf8'))));
        catalog.remove(id);res.writeHead(204);return res.end();
      }
      if(method==='GET' && path==='/plan') return json(200,{ids:planDependencies(catalog.list(),url.searchParams.get('ids')?.split(',')??[])});
      if(method==='GET' && path==='/export.csv') {res.writeHead(200,{'content-type':'text/csv; charset=utf-8'});return res.end(exportCSV(catalog.list()));}
      if(method==='POST' && path==='/import.csv') return json(201,{added:importCSV(data.toString('utf8'),catalog).length});
      if(method==='POST' && path==='/import.ndjson') return json(201,{added:(await importNDJSON([data],catalog)).length});
      if(method==='GET' && path==='/export.ndjson') {
        res.writeHead(200,{'content-type':'application/x-ndjson'});
        for await(const line of exportNDJSON(catalog.list())) if(!res.write(line)) await once(res,'drain');
        return res.end();
      }
      fail(404,'unknown route');
    }
    handle().catch(e=>{if(!res.headersSent) json(e.status??(/duplicate id/.test(e.message)?409:400),{error:e.message});else res.end();});
  });
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const server=createServer(createCatalog());server.listen(Number(process.env.PORT??3000));
}
