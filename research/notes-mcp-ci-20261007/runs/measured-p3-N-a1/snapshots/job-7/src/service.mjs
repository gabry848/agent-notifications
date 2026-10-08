import { importNotes } from './import.mjs';

export function allNotes(store) {
  const notes=[];
  for (let offset=0;;offset+=100) {
    const page=store.listNotes({limit:100,offset}); notes.push(...page);
    if (page.length<100) return notes;
  }
}
export function exportNotes(store) {
  return {version:1,notes:allNotes(store).reverse().map(({text,tags})=>({text,tags}))};
}
const text={type:'string',minLength:1,maxLength:4000};
const tags={type:'array',items:{type:'string',minLength:1,maxLength:40}};
const id={type:'integer',minimum:1};
const schema=(properties={},required=[])=>({type:'object',properties,required,additionalProperties:false});
export const tools=[
  ['notes_create','Create a note',schema({text,tags},['text'])],
  ['notes_get','Get a note',schema({id},['id'])],
  ['notes_list','Search notes',schema({q:{type:'string'},tag:{type:'string'},limit:{type:'integer',minimum:1,maximum:100},offset:{type:'integer',minimum:0}})],
  ['notes_update','Update a note',schema({id,text,tags},['id'])],
  ['notes_delete','Delete a note',schema({id},['id'])],
  ['tags_list','List tags and counts',schema()],
  ['notes_export','Export notes oldest first',schema()],
  ['notes_import','Import a validated batch',schema({notes:{type:'array',items:schema({text,tags},['text'])}},['notes'])]
].map(([name,description,inputSchema])=>({name,description,inputSchema}));
export function callTool(store,name,args={}) {
  const tool=tools.find(t=>t.name===name);
  if (!tool) throw new Error('Unknown tool');
  if (!args || typeof args!=='object' || Array.isArray(args)) throw new Error('Arguments must be an object');
  for (const key of tool.inputSchema.required) if (!Object.hasOwn(args,key)) throw new Error(`Missing ${key}`);
  for (const key of Object.keys(args)) if (!Object.hasOwn(tool.inputSchema.properties,key)) throw new Error(`Unknown argument ${key}`);
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
