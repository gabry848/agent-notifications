import {validateText, validateTags} from './store.mjs';

// Validate every field before the first write, including tags in later records.
export function importNotes(store, records) {
  if (!Array.isArray(records)) throw new Error('notes must be an array');
  const prepared = records.map(record => {
    if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('Each note must be an object');
    return {text:validateText(record.text), tags:validateTags(record.tags === undefined ? [] : record.tags)};
  });
  const write = () => prepared.map(record => store.createNote(record.text,record.tags));
  return typeof store.transaction === 'function' ? store.transaction(write) : write();
}

export function allNotes(store) {
  const notes = [];
  for (let offset=0;;offset+=100) {
    const batch = store.listNotes({limit:100,offset});
    notes.push(...batch);
    if (batch.length < 100) return notes;
  }
}
export function exportNotes(store) {
  return {version:1, notes:allNotes(store).reverse().map(({text,tags})=>({text,tags}))};
}
