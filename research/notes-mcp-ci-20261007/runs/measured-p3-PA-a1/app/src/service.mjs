import { importNotes } from './import.mjs';

export function allNotes(store) {
  const notes = [];
  for (let offset=0;;offset+=100) {
    const batch = store.listNotes({limit:100,offset}); notes.push(...batch);
    if (batch.length < 100) return notes;
  }
}
export function exportNotes(store) {
  return {version:1,notes:allNotes(store).reverse().map(({text,tags})=>({text,tags}))};
}
const text = {type:'string',minLength:1,maxLength:4000};
const tags = {type:'array',items:{type:'string',minLength:1,maxLength:40}};
const id = {type:'integer',minimum:1};
const definitions = [
  ['notes_create','Create a note',{text,tags},['text']],
  ['notes_get','Get a note',{id},['id']],
  ['notes_list','Search notes',{q:{type:'string'},tag:{type:'string'},limit:{type:'integer',minimum:1,maximum:100},offset:{type:'integer',minimum:0}},[]],
  ['notes_update','Update a note',{id,text,tags},['id']],
  ['notes_delete','Delete a note',{id},['id']],
  ['tags_list','List tag counts',{},[]],
  ['notes_export','Export notes',{},[]],
  ['notes_import','Import notes',{notes:{type:'array',items:{type:'object',properties:{text,tags},required:['text'],additionalProperties:false}}},['notes']]
];
export const tools = definitions.map(([name,description,properties,required])=>({name,description,inputSchema:{type:'object',properties,required,additionalProperties:false}}));
export function callTool(store,name,args={}) {
  const tool = tools.find(tool=>tool.name===name);
  if (!tool) throw new Error('Unknown tool');
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('arguments must be an object');
  if (tool.inputSchema.required.some(key=>!Object.hasOwn(args,key)) || Object.keys(args).some(key=>!Object.hasOwn(tool.inputSchema.properties,key))) throw new Error('Invalid tool arguments');
  switch(name) {
    case 'notes_create': return store.createNote(args.text,args.tags);
    case 'notes_get': return store.getNote(args.id);
    case 'notes_list': return store.listNotes(args);
    case 'notes_update': { const {id,...patch}=args; return store.updateNote(id,patch); }
    case 'notes_delete': return store.deleteNote(args.id);
    case 'tags_list': return store.listTags();
    case 'notes_export': return exportNotes(store);
    case 'notes_import': return importNotes(store,args.notes);
  }
}
