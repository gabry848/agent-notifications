import {parseVersion,compareVersions} from './version.mjs';
const cmp=(a,b)=>a===b?0:a<b?-1:1;
export function searchRecords(records,query={}) {
  if(!query || typeof query!=='object' || Array.isArray(query)) throw Error('invalid query');
  const {sortBy='id',order='asc',offset=0,limit=20}=query;
  if(!['id','name','version'].includes(sortBy) || !['asc','desc'].includes(order) || !Number.isInteger(offset) || offset<0 || !Number.isInteger(limit) || limit<1 || limit>100) throw Error('invalid sorting or paging');
  if(query.text!==undefined && typeof query.text!=='string') throw Error('invalid text');
  const text=(query.text??'').trim().toLowerCase(), tags=query.tags??[];
  if(!Array.isArray(tags) || tags.some(t=>typeof t!=='string')) throw Error('invalid tags');
  const required=[...new Set(tags.map(t=>t.trim().toLowerCase()).filter(Boolean))];
  for(const bound of ['versionMin','versionMax']) if(query[bound]!==undefined) parseVersion(query[bound]);
  const items=records.filter(r=>(!text || r.id.toLowerCase().includes(text) || r.name.toLowerCase().includes(text)) && required.every(t=>r.tags.map(v=>v.trim().toLowerCase()).includes(t)) && (query.versionMin===undefined || compareVersions(r.version,query.versionMin)>=0) && (query.versionMax===undefined || compareVersions(r.version,query.versionMax)<=0));
  items.sort((a,b)=> (sortBy==='version'?compareVersions(a.version,b.version):cmp(a[sortBy],b[sortBy]))*(order==='asc'?1:-1) || cmp(a.id,b.id));
  return {items:structuredClone(items.slice(offset,offset+limit)),total:items.length,offset,limit};
}
