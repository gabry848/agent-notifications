import {compareVersions, parseVersion} from './version.mjs';
export function searchRecords(records, query = {}) {
  if (!query || typeof query !== 'object' || Array.isArray(query)) throw Error('invalid query');
  const {sortBy = 'id', order = 'asc', offset = 0, limit = 20} = query;
  if (!['id','name','version'].includes(sortBy) || !['asc','desc'].includes(order) || !Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100) throw Error('invalid sort/order/paging');
  if (query.text !== undefined && typeof query.text !== 'string') throw Error('invalid text');
  const tags = query.tags ?? [];
  if (!Array.isArray(tags) || tags.some(t => typeof t !== 'string')) throw Error('invalid tags');
  const wanted = [...new Set(tags.map(t => t.trim().toLowerCase()).filter(Boolean))];
  const text = (query.text ?? '').trim().toLowerCase();
  if (query.versionMin !== undefined) parseVersion(query.versionMin);
  if (query.versionMax !== undefined) parseVersion(query.versionMax);
  const items = records.filter(r => (!text || r.id.toLowerCase().includes(text) || r.name.toLowerCase().includes(text)) && wanted.every(t => r.tags.map(v => v.trim().toLowerCase()).includes(t)) && (query.versionMin === undefined || compareVersions(r.version,query.versionMin) >= 0) && (query.versionMax === undefined || compareVersions(r.version,query.versionMax) <= 0));
  const cmp = (a,b) => a < b ? -1 : a > b ? 1 : 0;
  items.sort((a,b) => (sortBy === 'version' ? compareVersions(a.version,b.version) : cmp(a[sortBy],b[sortBy])) * (order === 'asc' ? 1 : -1) || cmp(a.id,b.id));
  return {items:items.slice(offset,offset + limit).map(r => ({...r,tags:[...r.tags],dependencies:[...r.dependencies]})), total:items.length, offset, limit};
}
