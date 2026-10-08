export function normalizeText(text) {
  if (typeof text !== 'string') throw new Error('text must be a string');
  text = text.trim();
  if (!text || text.length > 4000) throw new Error('text must contain 1–4000 characters');
  return text;
}
export function normalizeTag(tag) {
  if (typeof tag !== 'string') throw new Error('tags must contain strings');
  tag = tag.trim().toLowerCase();
  if (!tag || tag.length > 40) throw new Error('tags must contain 1–40 characters');
  return tag;
}
export function normalizeTags(tags = []) {
  if (!Array.isArray(tags)) throw new Error('tags must be an array');
  return [...new Set(tags.map(normalizeTag))].sort();
}
export function validateId(id) {
  if (!Number.isSafeInteger(id) || id < 1) throw new Error('id must be a positive integer');
  return id;
}
export function object(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('expected an object');
  return value;
}
