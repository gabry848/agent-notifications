import {compareVersions, parseVersion} from './version.mjs';
import {asciiCompare} from './catalog.mjs';
export function searchRecords(records, query = {}) {
  if (!Array.isArray(records) || !query || typeof query !== 'object' || Array.isArray(query)) throw Error('invalid search');
  const {sortBy = 'id', order = 'asc', offset = 0, limit = 20} = query;
  if (!['id', 'name', 'version'].includes(sortBy) || !['asc', 'desc'].includes(order)) throw Error('invalid sort/order');
  if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100) throw Error('invalid paging');
  if (query.text !== undefined && typeof query.text !== 'string') throw Error('invalid text');
  if (query.tags !== undefined && (!Array.isArray(query.tags) || query.tags.some(t => typeof t !== 'string'))) throw Error('invalid tags');
  const text = (query.text ?? '').trim().toLowerCase();
  const tags = [...new Set((query.tags ?? []).map(t => t.trim().toLowerCase()).filter(Boolean))];
  if (query.versionMin !== undefined) parseVersion(query.versionMin);
  if (query.versionMax !== undefined) parseVersion(query.versionMax);
  const found = records.filter(r => (!text || r.name.toLowerCase().includes(text) || r.id.toLowerCase().includes(text)) &&
    tags.every(t => r.tags.map(v => v.trim().toLowerCase()).includes(t)) &&
    (query.versionMin === undefined || compareVersions(r.version, query.versionMin) >= 0) &&
    (query.versionMax === undefined || compareVersions(r.version, query.versionMax) <= 0));
  found.sort((a, b) => {
    const c = sortBy === 'version' ? compareVersions(a.version, b.version) : asciiCompare(a[sortBy], b[sortBy]);
    return (order === 'desc' ? -c : c) || asciiCompare(a.id, b.id);
  });
  return {items: structuredClone(found.slice(offset, offset + limit)), total: found.length, offset, limit};
}
