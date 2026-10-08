export function textValue(text) {
  if (typeof text !== 'string') throw new Error('text must be a string');
  text = text.trim();
  if (!text || text.length > 4000) throw new Error('text must contain 1–4000 characters');
  return text;
}
export function tagValue(tag) {
  if (typeof tag !== 'string') throw new Error('tags must be strings');
  tag = tag.trim().toLowerCase();
  if (!tag || tag.length > 40) throw new Error('tags must contain 1–40 characters');
  return tag;
}
export function tagsValue(tags) {
  if (!Array.isArray(tags)) throw new Error('tags must be an array');
  return [...new Set(tags.map(tagValue))].sort();
}
export function idValue(id) {
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('id must be a positive integer');
  return id;
}
export function objectValue(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('expected an object');
  return value;
}
export function noteValue(record) {
  objectValue(record);
  return {text: textValue(record.text), tags: tagsValue(record.tags === undefined ? [] : record.tags)};
}
