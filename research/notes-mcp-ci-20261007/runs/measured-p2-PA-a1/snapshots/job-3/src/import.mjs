import { normalizeText, normalizeTags } from './store.mjs';

export function importNotes(store, records) {
  if (!Array.isArray(records)) throw new Error('notes must be an array');
  const prepared = records.map(record => {
    if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('invalid note record');
    return { text: normalizeText(record.text), tags: normalizeTags(record.tags === undefined ? [] : record.tags) };
  });
  const write = () => prepared.map(record => store.createNote(record.text, record.tags));
  return store.transaction ? store.transaction(write) : write();
}

export function allNotes(store) {
  const notes = [];
  for (let offset = 0; ; offset += 100) {
    const page = store.listNotes({limit:100, offset});
    notes.push(...page);
    if (page.length < 100) return notes;
  }
}
export function exportNotes(store) {
  return {version:1, notes:allNotes(store).reverse().map(({text,tags}) => ({text,tags}))};
}
