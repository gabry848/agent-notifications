import { validateText, validateTags, validateObject } from './validation.mjs';

export function importNotes(store, records) {
  if (!Array.isArray(records)) throw new Error('notes must be an array');
  const prepared = records.map(record => {
    validateObject(record);
    return { text: validateText(record.text), tags: validateTags(record.tags) };
  });
  const write = () => prepared.map(record => store.createNote(record.text, record.tags));
  return store.transaction ? store.transaction(write) : write();
}
