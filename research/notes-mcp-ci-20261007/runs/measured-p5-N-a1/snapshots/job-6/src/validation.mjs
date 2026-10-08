export function normalizeText(text) {
  if (typeof text !== 'string' || !text.trim() || text.trim().length > 4000)
    throw new Error('text must contain 1–4000 characters');
  return text.trim();
}
export function normalizeTag(tag) {
  if (typeof tag !== 'string' || !tag.trim() || tag.trim().length > 40)
    throw new Error('tags must be nonempty strings of at most 40 characters');
  return tag.trim().toLowerCase();
}
export function normalizeTags(tags) {
  if (!Array.isArray(tags)) throw new Error('tags must be an array');
  return [...new Set(Array.from(tags,normalizeTag))].sort();
}
export function validId(id) {
  if (!Number.isSafeInteger(id) || id < 1) throw new Error('id must be a positive integer');
  return id;
}
export function object(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('expected an object');
  return value;
}
