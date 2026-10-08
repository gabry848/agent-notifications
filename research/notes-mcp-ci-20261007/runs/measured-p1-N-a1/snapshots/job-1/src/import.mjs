// Shared legacy bulk importer. Text is checked up front; per-note validation lives in the store.
export function importNotes(store, records) {
  if (!Array.isArray(records)) throw new Error('notes must be an array');
  const prepared = records.map(record => {
    if (!record || typeof record.text !== 'string' || !record.text.trim() || record.text.trim().length > 4000)
      throw new Error('invalid note text');
    return {text:record.text.trim(),tags:record.tags??[]};
  });
  return prepared.map(record => store.createNote(record.text,record.tags));
}
