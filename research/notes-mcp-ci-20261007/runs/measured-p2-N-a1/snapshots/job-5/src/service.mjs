import { importNotes } from './import.mjs';
import { validateObject } from './validation.mjs';

export function allNotes(store) {
  const notes = [];
  for (let offset = 0; ; offset += 100) {
    const page = store.listNotes({ limit: 100, offset });
    notes.push(...page);
    if (page.length < 100) return notes;
  }
}
export function exportNotes(store) {
  return { version: 1, notes: allNotes(store).reverse().map(({ text, tags }) => ({ text, tags })) };
}
const string = { type: 'string' }, id = { type: 'integer', minimum: 1 };
const tags = { type: 'array', items: { type: 'string', minLength: 1, maxLength: 40 } };
const note = { type: 'object', properties: { text: { ...string, minLength: 1, maxLength: 4000 }, tags }, required: ['text'], additionalProperties: false };
export const tools = [
  ['notes_create', 'Create a note', note.properties, ['text']],
  ['notes_get', 'Get a note', { id }, ['id']],
  ['notes_list', 'Search and list notes', { q: string, tag: string, limit: { type: 'integer', minimum: 1, maximum: 100 }, offset: { type: 'integer', minimum: 0 } }, []],
  ['notes_update', 'Update a note', { id, ...note.properties }, ['id']],
  ['notes_delete', 'Delete a note', { id }, ['id']],
  ['tags_list', 'List tag counts', {}, []],
  ['notes_export', 'Export notes oldest first', {}, []],
  ['notes_import', 'Import a validated batch', { notes: { type: 'array', items: note } }, ['notes']]
].map(([name, description, properties, required]) => ({ name, description, inputSchema: { type: 'object', properties, required, additionalProperties: false } }));
export function callTool(store, name, args = {}) {
  validateObject(args);
  const descriptor = tools.find(tool => tool.name === name);
  if (!descriptor) throw new Error('Unknown tool');
  for (const key of descriptor.inputSchema.required) if (!Object.hasOwn(args, key)) throw new Error(`Missing ${key}`);
  for (const key of Object.keys(args)) if (!Object.hasOwn(descriptor.inputSchema.properties, key)) throw new Error(`Unknown argument ${key}`);
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
