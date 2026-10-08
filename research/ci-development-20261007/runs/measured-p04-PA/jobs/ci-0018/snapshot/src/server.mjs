import http from 'node:http';
import {searchRecords} from './search.mjs';
import {planDependencies} from './graph.mjs';
import {exportCSV, importCSV, exportNDJSON, importNDJSON} from './transfer.mjs';
const MAX_BODY = 1024 * 1024;
async function body(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) {
      // Drain rather than destroy the socket, allowing the 413 response to arrive.
      const error = Error('request body exceeds 1 MiB'); error.status = 413; throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}
function json(res,status,value) { res.writeHead(status,{'content-type':'application/json'}); res.end(JSON.stringify(value)); }
export function createServer(catalog) {
  return http.createServer(async (req,res) => {
    try {
      const url = new URL(req.url,'http://localhost'), path = url.pathname, method = req.method;
      if (method === 'GET' && path === '/health') return json(res,200,{ok:true});
      if (method === 'GET' && path === '/records') {
        const query = {};
        for (const key of ['text','versionMin','versionMax','sortBy','order']) if (url.searchParams.has(key)) query[key] = url.searchParams.get(key);
        if (url.searchParams.has('tags')) query.tags = url.searchParams.get('tags').split(',');
        for (const key of ['offset','limit']) if (url.searchParams.has(key)) {
          const value = url.searchParams.get(key);
          if (!/^\d+$/.test(value)) throw Error(`invalid ${key}`);
          query[key] = Number(value);
        }
        return json(res,200,searchRecords(catalog.list(),query));
      }
      if (method === 'POST' && path === '/records') return json(res,201,catalog.add(JSON.parse(await body(req))));
      if (path.startsWith('/records/') && !path.slice(9).includes('/') && ['GET','PATCH','DELETE'].includes(method)) {
        const id = decodeURIComponent(path.slice(9));
        if (!catalog.get(id)) return json(res,404,{error:`unknown id: ${id}`});
        if (method === 'GET') return json(res,200,catalog.get(id));
        if (method === 'PATCH') return json(res,200,catalog.update(id,JSON.parse(await body(req))));
        catalog.remove(id); res.writeHead(204); return res.end();
      }
      if (method === 'GET' && path === '/plan') return json(res,200,{ids:planDependencies(catalog.list(),url.searchParams.get('ids')?.split(',').filter(Boolean) ?? [])});
      if (method === 'GET' && path === '/export.csv') { res.writeHead(200,{'content-type':'text/csv'}); return res.end(exportCSV(catalog.list())); }
      if (method === 'POST' && path === '/import.csv') return json(res,201,{added:importCSV(await body(req),catalog).length});
      if (method === 'POST' && path === '/import.ndjson') {
        const text = await body(req);
        return json(res,201,{added:(await importNDJSON([text],catalog)).length});
      }
      if (method === 'GET' && path === '/export.ndjson') {
        res.writeHead(200,{'content-type':'application/x-ndjson'});
        for await (const line of exportNDJSON(catalog.list())) res.write(line);
        return res.end();
      }
      return json(res,404,{error:'unknown route'});
    } catch (error) {
      if (!res.headersSent) json(res,error.status ?? (/duplicate id/.test(error.message) ? 409 : 400),{error:error.message});
      else res.end();
    }
  });
}
