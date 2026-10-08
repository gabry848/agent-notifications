import { noteValue } from './validation.mjs';

export function importNotes(store, records) {
  if (!Array.isArray(records)) throw new Error('notes must be an array');
  // Validate every field before the first write, including late-record tags.
  const prepared = records.map(noteValue);
  if (typeof store.createNotes === 'function') return store.createNotes(prepared);
  return prepared.map(record => store.createNote(record.text, record.tags));
}

export function allNotes(store) {
  const result = [];
  for (let offset = 0; ; offset += 100) {
    const batch = store.listNotes({limit:100, offset});
    result.push(...batch);
    if (batch.length < 100) return result;
  }
}
export function exportNotes(store) {
  return {version:1, notes:allNotes(store).reverse().map(({text,tags}) => ({text,tags}))};
}
