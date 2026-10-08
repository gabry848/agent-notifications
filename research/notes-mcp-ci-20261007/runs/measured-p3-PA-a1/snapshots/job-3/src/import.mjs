import { validateText, validateTags } from './store.mjs';

// Validate every field in the entire batch before the first write.
export function importNotes(store, records) {
  if (!Array.isArray(records)) throw new Error('notes must be an array');
  const prepared = records.map(record => {
    if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('invalid note record');
    return {text:validateText(record.text),tags:validateTags(record.tags === undefined ? [] : record.tags)};
  });
  return prepared.map(record => store.createNote(record.text,record.tags));
}
