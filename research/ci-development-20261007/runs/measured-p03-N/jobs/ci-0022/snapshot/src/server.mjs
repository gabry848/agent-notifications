import http from 'node:http';
import {pathToFileURL} from 'node:url';
import {createCatalog} from './catalog.mjs';
import {searchRecords} from './search.mjs';
import {planDependencies} from './graph.mjs';
import {exportCSV, importCSV, exportNDJSON, importNDJSON} from './transfer.mjs';
const MAX_BODY = 1024 * 1024;
function failure(status, message) { return Object.assign(new Error(message), {status}); }
async function body(req) {
  const chunks = []; let size = 0;
  // Drain excess input without retaining it so an error response can reach the client.
  for await (const chunk of req) {
    size += chunk.length;
    if (size <= MAX_BODY) chunks.push(chunk);
  }
  if (size > MAX_BODY) throw failure(413, 'Request body exceeds 1 MiB');
  return Buffer.concat(chunks);
}
function send(res, status, value, type = 'application/json') {
  res.writeHead(status, {'content-type': type});
  res.end(status === 204 ? undefined : type === 'application/json' ? JSON.stringify(value) : value);
}
export function createServer(catalog) {
  return http.createServer((req, res) => {
    handle(req, res, catalog).catch(error => {
      if (res.headersSent) { res.destroy(); return; }
      send(res, error.status ?? (/duplicate/i.test(error.message) ? 409 : 400), {error: error.message || 'Invalid request'});
    });
  });
}
async function handle(req, res, catalog) {
  const url = new URL(req.url, 'http://localhost'), path = url.pathname, method = req.method;
  if (method === 'GET' && path === '/health') return send(res, 200, {ok: true});
  if (method === 'GET' && path === '/records') {
    const query = {};
    for (const key of ['text', 'versionMin', 'versionMax', 'sortBy', 'order']) if (url.searchParams.has(key)) query[key] = url.searchParams.get(key);
    if (url.searchParams.has('tags')) query.tags = url.searchParams.get('tags').split(',');
    for (const key of ['offset', 'limit']) if (url.searchParams.has(key)) {
      const value = url.searchParams.get(key);
      if (!/^\d+$/.test(value)) throw failure(400, 'Invalid paging');
      query[key] = Number(value);
    }
    return send(res, 200, searchRecords(catalog.list(), query));
  }
  if (method === 'POST' && path === '/records') return send(res, 201, catalog.add(JSON.parse((await body(req)).toString('utf8'))));
  const match = /^\/records\/([^/]+)$/.exec(path);
  if (match && ['GET', 'PATCH', 'DELETE'].includes(method)) {
    const id = decodeURIComponent(match[1]);
    if (!catalog.get(id)) throw failure(404, `Unknown id: ${id}`);
    if (method === 'GET') return send(res, 200, catalog.get(id));
    if (method === 'PATCH') return send(res, 200, catalog.update(id, JSON.parse((await body(req)).toString('utf8'))));
    catalog.remove(id); return send(res, 204);
  }
  if (method === 'GET' && path === '/plan') {
    const ids = url.searchParams.get('ids');
    return send(res, 200, {ids: planDependencies(catalog.list(), ids ? ids.split(',') : [])});
  }
  if (method === 'GET' && path === '/export.csv') return send(res, 200, exportCSV(catalog.list()), 'text/csv; charset=utf-8');
  if (method === 'POST' && path === '/import.csv') return send(res, 201, {added: importCSV((await body(req)).toString('utf8'), catalog).length});
  if (method === 'POST' && path === '/import.ndjson') {
    const data = await body(req);
    return send(res, 201, {added: (await importNDJSON([data], catalog)).length});
  }
  if (method === 'GET' && path === '/export.ndjson') {
    res.writeHead(200, {'content-type': 'application/x-ndjson; charset=utf-8'});
    for await (const line of exportNDJSON(catalog.list())) res.write(line);
    res.end(); return;
  }
  throw failure(404, 'Unknown route');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createServer(createCatalog()).listen(Number(process.env.PORT ?? 3000), () => console.log('Package Catalog listening'));
}
