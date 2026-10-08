import http from 'node:http';
import {pathToFileURL} from 'node:url';
import {createCatalog} from './catalog.mjs';
import {searchRecords} from './search.mjs';
import {planDependencies} from './graph.mjs';
import {exportCSV, importCSV, exportNDJSON, importNDJSON} from './transfer.mjs';
const MAX_BODY = 1024 * 1024;
function failure(message, status = 400) { return Object.assign(Error(message), {status}); }
function readBody(req) {
  return new Promise((resolve,reject) => {
    const chunks = []; let size = 0, oversized = false;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY) {
        if (!oversized) { oversized = true; chunks.length = 0; reject(failure('Request body exceeds 1 MiB',413)); }
      } else if (!oversized) chunks.push(chunk);
    });
    req.on('end', () => { if (!oversized) resolve(Buffer.concat(chunks)); });
    req.on('error', reject);
    req.on('aborted', () => reject(failure('Request aborted')));
  });
}
export function createServer(catalog) {
  return http.createServer((req,res) => {
    const send = (status, value, type = 'application/json') => {
      res.writeHead(status, {'Content-Type': type});
      res.end(status === 204 ? undefined : type === 'application/json' ? JSON.stringify(value) : value);
    };
    async function handle() {
      const url = new URL(req.url, 'http://localhost'), path = url.pathname, method = req.method;
      if (method === 'GET' && path === '/health') return send(200,{ok:true});
      if (path === '/records') {
        if (method === 'GET') {
          const query = {};
          for (const key of ['text','versionMin','versionMax','sortBy','order']) if (url.searchParams.has(key)) query[key] = url.searchParams.get(key);
          if (url.searchParams.has('tags')) query.tags = url.searchParams.get('tags').split(',');
          for (const key of ['offset','limit']) if (url.searchParams.has(key)) {
            const value = url.searchParams.get(key);
            if (!/^\d+$/.test(value)) throw failure('Invalid paging');
            query[key] = Number(value);
          }
          return send(200,searchRecords(catalog.list(),query));
        }
        if (method === 'POST') {
          const record = JSON.parse((await readBody(req)).toString('utf8'));
          try { return send(201,catalog.add(record)); }
          catch (error) { if (/duplicate/i.test(error.message)) error.status = 409; throw error; }
        }
      }
      const match = path.match(/^\/records\/([^/]+)$/);
      if (match && ['GET','PATCH','DELETE'].includes(method)) {
        const id = decodeURIComponent(match[1]);
        if (!catalog.get(id)) throw failure(`Unknown id: ${id}`,404);
        if (method === 'GET') return send(200,catalog.get(id));
        if (method === 'PATCH') return send(200,catalog.update(id,JSON.parse((await readBody(req)).toString('utf8'))));
        catalog.remove(id); return send(204);
      }
      if (method === 'GET' && path === '/plan') {
        const ids = url.searchParams.get('ids');
        if (ids === null) throw failure('Missing ids');
        return send(200,{ids:planDependencies(catalog.list(),ids ? ids.split(',') : [])});
      }
      if (method === 'GET' && path === '/export.csv') return send(200,exportCSV(catalog.list()),'text/csv');
      if (method === 'POST' && path === '/import.csv') return send(201,{added:importCSV((await readBody(req)).toString('utf8'),catalog).length});
      if (method === 'POST' && path === '/import.ndjson') {
        const body = await readBody(req);
        return send(201,{added:(await importNDJSON([body],catalog)).length});
      }
      if (method === 'GET' && path === '/export.ndjson') {
        let text = ''; for await (const line of exportNDJSON(catalog.list())) text += line;
        return send(200,text,'application/x-ndjson');
      }
      throw failure('Not found',404);
    }
    handle().catch(error => {
      if (!res.headersSent && !res.destroyed) send(error.status ?? 400,{error:error.message});
      else if (!res.destroyed) res.end();
    });
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createServer(createCatalog()).listen(Number(process.env.PORT ?? 3000));
}
