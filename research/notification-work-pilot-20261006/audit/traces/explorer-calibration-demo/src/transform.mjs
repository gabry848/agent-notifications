export function sanitize(value, redactedKeys) {
  const keys = new Set(redactedKeys);
  function copy(v) {
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(copy);
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, keys.has(k) ? '[redacted]' : copy(x)]));
  }
  return copy(value);
}
