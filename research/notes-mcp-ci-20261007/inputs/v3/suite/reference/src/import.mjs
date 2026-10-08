import {validateText,validateTags} from './store.mjs';
export function importNotes(store,records){
  if(!Array.isArray(records))throw new Error('notes must be an array');
  const prepared=records.map(record=>({text:validateText(record?.text),tags:validateTags(record?.tags??[])}));
  return prepared.map(record=>store.createNote(record.text,record.tags));
}
