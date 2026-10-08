import {parseVersion, compareVersions} from './version.mjs';
const cmp = (a,b) => a === b ? 0 : a < b ? -1 : 1;
export function searchRecords(records, query = {}) {
  if (!query || typeof query !== 'object' || Array.isArray(query)) throw Error('Invalid query');
  const {text = '', tags = [], versionMin, versionMax, sortBy = 'id', order = 'asc', offset = 0, limit = 20} = query;
  if (typeof text !== 'string' || !Array.isArray(tags) || tags.some(t => typeof t !== 'string')) throw Error('Invalid search');
  if (!['id','name','version'].includes(sortBy) || !['asc','desc'].includes(order) || !Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100) throw Error('Invalid sort/order/paging');
  if (versionMin !== undefined) parseVersion(versionMin);
  if (versionMax !== undefined) parseVersion(versionMax);
  const needle = text.trim().toLowerCase(), required = [...new Set(tags.map(t => t.trim().toLowerCase()).filter(Boolean))];
  const items = records.filter(r => (!needle || r.id.toLowerCase().includes(needle) || r.name.toLowerCase().includes(needle)) && required.every(t => r.tags.map(x => x.trim().toLowerCase()).includes(t)) && (versionMin === undefined || compareVersions(r.version, versionMin) >= 0) && (versionMax === undefined || compareVersions(r.version, versionMax) <= 0));
  items.sort((a,b) => (order === 'asc' ? 1 : -1) * (sortBy === 'version' ? compareVersions(a.version,b.version) : cmp(a[sortBy],b[sortBy])) || cmp(a.id,b.id));
  return {items: structuredClone(items.slice(offset,offset + limit)), total: items.length, offset, limit};
}
