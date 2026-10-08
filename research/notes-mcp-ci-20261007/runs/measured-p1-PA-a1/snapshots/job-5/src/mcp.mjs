import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import { openStore } from './store.mjs';
import { importNotes, exportNotes, allNotes } from './import.mjs';
import { object } from './validation.mjs';

const { values } = parseArgs({ options: { db: { type: 'string', default: 'data/notes.sqlite' } } });
const store = openStore(values.db);
const text = { type: 'string', minLength: 1, maxLength: 4000 };
const tags = { type: 'array', items: { type: 'string', minLength: 1, maxLength: 40 } };
const id = { type: 'integer', minimum: 1 };
const schemas = {
  notes_create: [{ text, tags }, ['text']],
  notes_get: [{ id }, ['id']],
  notes_list: [{ q: { type: 'string' }, tag: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 }, offset: { type: 'integer', minimum: 0 } }, []],
  notes_update: [{ id, text, tags }, ['id']],
  notes_delete: [{ id }, ['id']],
  tags_list: [{}, []],
  notes_export: [{}, []],
  notes_import: [{ notes: { type: 'array', items: { type: 'object', properties: { text, tags }, required: ['text'], additionalProperties: false } } }, ['notes']]
};
const tools = Object.entries(schemas).map(([name, [properties, required]]) => ({
  name, description: name.replaceAll('_', ' '), inputSchema: { type: 'object', properties, required, additionalProperties: false }
}));
function call(name, args = {}) {
  object(args);
  if (!Object.hasOwn(schemas, name)) throw new Error(`Unknown tool: ${name}`);
  const [props, required] = schemas[name];
  if (Object.keys(args).some(k => !Object.hasOwn(props, k)) || required.some(k => !Object.hasOwn(args, k))) throw new Error('Invalid tool arguments');
  switch (name) {
    case 'notes_create': return store.createNote(args.text, args.tags);
    case 'notes_get': return store.getNote(args.id);
    case 'notes_list': return store.listNotes(args);
    case 'notes_update': { const { id, ...patch } = args; return store.updateNote(id, patch); }
    case 'notes_delete': return store.deleteNote(args.id);
    case 'tags_list': return store.listTags();
    case 'notes_export': return exportNotes(store);
    case 'notes_import': return importNotes(store, args.notes);
  }
}
function dispatch(method, params) {
  switch (method) {
    case 'initialize': return { protocolVersion: '2024-11-05', capabilities: { tools: {}, resources: {} }, serverInfo: { name: 'quick-notes', version: '1.0.0' } };
    case 'ping': return {};
    case 'tools/list': return { tools };
    case 'tools/call':
      try { object(params); return { content: [{ type: 'text', text: JSON.stringify(call(params.name, params.arguments)) }] }; }
      catch (error) { return { isError: true, content: [{ type: 'text', text: error.message }] }; }
    case 'resources/list': return { resources: [{ uri: 'notes://all', name: 'All notes', mimeType: 'application/json' }] };
    case 'resources/read':
      if (params?.uri !== 'notes://all') throw { code: -32002, message: 'Unknown resource' };
      return { contents: [{ uri: 'notes://all', mimeType: 'application/json', text: JSON.stringify(allNotes(store)) }] };
    default: throw { code: -32601, message: 'Method not found' };
  }
}
function send(value) { process.stdout.write(JSON.stringify(value) + '\n'); }
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on('line', line => {
  if (!line.trim()) return;
  let request;
  try { request = JSON.parse(line); }
  catch { send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); return; }
  if (!request || Array.isArray(request) || request.jsonrpc !== '2.0' || typeof request.method !== 'string' ||
      (Object.hasOwn(request, 'id') && request.id !== null && typeof request.id !== 'string' && typeof request.id !== 'number')) {
    send({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid request' } }); return;
  }
  // All valid notifications are response-free, including initialized.
  if (!Object.hasOwn(request, 'id')) return;
  try { send({ jsonrpc: '2.0', id: request.id, result: dispatch(request.method, request.params) }); }
  catch (error) { send({ jsonrpc: '2.0', id: request.id, error: { code: error.code ?? -32602, message: error.message ?? 'Invalid params' } }); }
});
input.on('close', () => store.close());
