import { createInterface } from 'node:readline';
import { openStore } from './store.mjs';
import { importNotes, exportNotes, allNotes } from './import.mjs';
import { options } from './cli.mjs';

const store = openStore(options({ db: 'data/notes.sqlite' }).db);
const text = { type: 'string', minLength: 1, maxLength: 4000 };
const tags = { type: 'array', items: { type: 'string', minLength: 1, maxLength: 40 } };
const id = { type: 'integer', minimum: 1 };
const object = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const tools = [
  ['notes_create', 'Create a note', object({ text, tags }, ['text']), a => store.createNote(a.text, a.tags)],
  ['notes_get', 'Read a note', object({ id }, ['id']), a => store.getNote(a.id)],
  ['notes_list', 'Search notes, newest first', object({ q: { type: 'string' }, tag: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 }, offset: { type: 'integer', minimum: 0 } }), a => store.listNotes(a)],
  ['notes_update', 'Replace note text or tags', object({ id, text, tags }, ['id']), ({ id, ...patch }) => store.updateNote(id, patch)],
  ['notes_delete', 'Delete a note', object({ id }, ['id']), a => store.deleteNote(a.id)],
  ['tags_list', 'List tags and counts', object(), () => store.listTags()],
  ['notes_export', 'Export notes oldest first', object(), () => exportNotes(store)],
  ['notes_import', 'Atomically import notes', object({ notes: { type: 'array', items: object({ text, tags }, ['text']) } }, ['notes']), a => importNotes(store, a.notes)]
];
function validate(value, schema) {
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object');
    for (const key of schema.required) if (!Object.hasOwn(value, key)) throw new Error(`Missing ${key}`);
    for (const key of Object.keys(value)) {
      if (!schema.properties[key]) throw new Error(`Unknown field: ${key}`);
      validate(value[key], schema.properties[key]);
    }
  } else if (schema.type === 'array') {
    if (!Array.isArray(value)) throw new Error('Expected an array');
    value.forEach(item => validate(item, schema.items));
  } else if (schema.type === 'integer') {
    if (!Number.isSafeInteger(value) || value < schema.minimum || (schema.maximum !== undefined && value > schema.maximum)) throw new Error('Invalid integer');
  } else if (typeof value !== 'string' || (schema.minLength && value.length < schema.minLength) || (schema.maxLength && value.length > schema.maxLength)) throw new Error('Invalid string');
}
const fault = (code, message) => Object.assign(new Error(message), { code });
function dispatch(method, params) {
  switch (method) {
    case 'initialize': return { protocolVersion: '2024-11-05', capabilities: { tools: {}, resources: {} }, serverInfo: { name: 'quick-notes', version: '1.0.0' } };
    case 'notifications/initialized': case 'ping': return {};
    case 'tools/list': return { tools: tools.map(([name, description, inputSchema]) => ({ name, description, inputSchema })) };
    case 'tools/call': {
      try {
        const tool = tools.find(t => t[0] === params?.name);
        if (!tool) throw new Error('Unknown tool');
        const args = params.arguments === undefined ? {} : params.arguments;
        validate(args, tool[2]);
        return { content: [{ type: 'text', text: JSON.stringify(tool[3](args)) }] };
      } catch (error) { return { isError: true, content: [{ type: 'text', text: error.message }] }; }
    }
    case 'resources/list': return { resources: [{ uri: 'notes://all', name: 'All notes', mimeType: 'application/json' }] };
    case 'resources/read':
      if (params?.uri !== 'notes://all') throw fault(-32002, 'Unknown resource');
      return { contents: [{ uri: 'notes://all', mimeType: 'application/json', text: JSON.stringify(allNotes(store)) }] };
    default: throw fault(-32601, 'Method not found');
  }
}
const send = value => process.stdout.write(JSON.stringify(value) + '\n');
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
  const respond = Object.hasOwn(request, 'id');
  try {
    const result = dispatch(request.method, request.params);
    if (respond) send({ jsonrpc: '2.0', id: request.id, result });
  } catch (error) {
    if (respond) send({ jsonrpc: '2.0', id: request.id, error: { code: error.code ?? -32602, message: error.message } });
  }
});
input.on('close', () => store.close());
process.on('SIGINT', () => input.close());
process.on('SIGTERM', () => input.close());
