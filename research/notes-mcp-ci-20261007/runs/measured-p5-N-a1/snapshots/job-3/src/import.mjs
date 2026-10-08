import { normalizeText, normalizeTags, object } from './validation.mjs';

// Validate the entire batch, including tags, before the first write.
export function importNotes(store, records) {
  if (!Array.isArray(records)) throw new Error('notes must be an array');
  const prepared = records.map(record => {
    object(record);
    return {text:normalizeText(record.text),tags:normalizeTags(record.tags === undefined ? [] : record.tags)};
  });
  const create = () => prepared.map(record => store.createNote(record.text,record.tags));
  return store.transaction ? store.transaction(create) : create();
}

export function allNotes(store) {
  const notes = [];
  for (let offset=0;;offset+=100) {
    const page = store.listNotes({limit:100,offset});
    notes.push(...page);
    if (page.length<100) return notes;
  }
}
export function exportNotes(store) {
  return {version:1,notes:allNotes(store).reverse().map(({text,tags})=>({text,tags}))};
}
