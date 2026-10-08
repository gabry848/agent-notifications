import {parseVersion, compareVersions} from './version.mjs';
const cmp = (a, b) => a < b ? -1 : a > b ? 1 : 0;
export function searchRecords(records, query = {}) {
  if (!query || typeof query !== 'object' || Array.isArray(query)) throw new Error('Invalid query');
  const {sortBy = 'id', order = 'asc', offset = 0, limit = 20} = query;
  if (!['id', 'name', 'version'].includes(sortBy) || !['asc', 'desc'].includes(order)) throw new Error('Invalid sort/order');
  if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid paging');
  if (query.text !== undefined && typeof query.text !== 'string') throw new Error('Invalid text');
  const text = (query.text ?? '').trim().toLowerCase();
  const tags = query.tags ?? [];
  if (!Array.isArray(tags) || tags.some(t => typeof t !== 'string')) throw new Error('Invalid tags');
  const normalized = [...new Set(tags.map(t => t.trim().toLowerCase()).filter(Boolean))];
  for (const key of ['versionMin', 'versionMax']) if (query[key] !== undefined) parseVersion(query[key]);
  const items = records.filter(r => (!text || r.id.toLowerCase().includes(text) || r.name.toLowerCase().includes(text)) &&
    normalized.every(t => r.tags.map(x => x.trim().toLowerCase()).includes(t)) &&
    (query.versionMin === undefined || compareVersions(r.version, query.versionMin) >= 0) &&
    (query.versionMax === undefined || compareVersions(r.version, query.versionMax) <= 0));
  items.sort((a, b) => {
    const n = sortBy === 'version' ? compareVersions(a.version, b.version) : cmp(a[sortBy], b[sortBy]);
    return n ? n * (order === 'desc' ? -1 : 1) : cmp(a.id, b.id);
  });
  return {items: structuredClone(items.slice(offset, offset + limit)), total: items.length, offset, limit};
}
