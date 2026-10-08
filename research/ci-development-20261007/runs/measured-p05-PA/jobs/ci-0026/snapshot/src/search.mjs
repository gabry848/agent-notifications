import {compareVersions, parseVersion} from './version.mjs';

export function searchRecords(records, query = {}) {
  if (!Array.isArray(records) || !query || typeof query !== 'object' || Array.isArray(query)) throw new Error('Invalid search');
  const {text = '', tags = [], versionMin, versionMax, sortBy = 'id', order = 'asc', offset = 0, limit = 20} = query;
  if (typeof text !== 'string' || !Array.isArray(tags) || tags.some(t => typeof t !== 'string')) throw new Error('Invalid filters');
  if (!['id', 'name', 'version'].includes(sortBy) || !['asc', 'desc'].includes(order)) throw new Error('Invalid sort');
  if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid paging');
  if (versionMin !== undefined) parseVersion(versionMin);
  if (versionMax !== undefined) parseVersion(versionMax);
  const needle = text.trim().toLowerCase();
  const required = [...new Set(tags.map(t => t.trim().toLowerCase()).filter(Boolean))];
  const items = records.filter(r => {
    const normalizedTags = r.tags.map(t => t.trim().toLowerCase());
    return (r.id.toLowerCase().includes(needle) || r.name.toLowerCase().includes(needle)) &&
      required.every(t => normalizedTags.includes(t)) &&
      (versionMin === undefined || compareVersions(r.version, versionMin) >= 0) &&
      (versionMax === undefined || compareVersions(r.version, versionMax) <= 0);
  });
  const cmp = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  items.sort((a, b) => {
    const primary = sortBy === 'version' ? compareVersions(a.version, b.version) : cmp(a[sortBy], b[sortBy]);
    return primary * (order === 'desc' ? -1 : 1) || cmp(a.id, b.id);
  });
  return {items: items.slice(offset, offset + limit).map(r => structuredClone(r)), total: items.length, offset, limit};
}
