export function validateText(text) {
  if (typeof text !== 'string' || !text.trim() || text.trim().length > 4000)
    throw new Error('text must be a string containing 1–4000 characters');
  return text.trim();
}
export function validateTags(tags = []) {
  if (!Array.isArray(tags)) throw new Error('tags must be an array');
  return [...new Set(tags.map(tag => {
    if (typeof tag !== 'string' || !tag.trim() || tag.trim().length > 40)
      throw new Error('tags must contain nonempty strings of at most 40 characters');
    return tag.trim().toLowerCase();
  }))].sort();
}
export function validateId(id) {
  if (!Number.isSafeInteger(id) || id < 1) throw new Error('id must be a positive integer');
  return id;
}
export function validateObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('expected an object');
  return value;
}
