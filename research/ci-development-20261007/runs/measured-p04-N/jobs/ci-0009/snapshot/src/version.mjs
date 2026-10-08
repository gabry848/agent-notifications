export function parseVersion(text) {
  if (typeof text !== 'string') throw Error('invalid version');
  const match = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*))?$/.exec(text);
  if (!match) throw Error('invalid version');
  const prerelease = match[4] ? match[4].split('.') : [];
  if (prerelease.some(p => /^\d+$/.test(p) && p.length > 1 && p[0] === '0')) throw Error('invalid version');
  return {major:Number(match[1]), minor:Number(match[2]), patch:Number(match[3]), prerelease};
}
const cmp = (a,b) => a < b ? -1 : a > b ? 1 : 0;
export function compareVersions(a,b) {
  const x = parseVersion(a), y = parseVersion(b);
  // Compare the original digits to retain precision even beyond safe integers.
  const ax = a.split('-')[0].split('.'), by = b.split('-')[0].split('.');
  const numeric = (p,q) => cmp(p.length,q.length) || cmp(p,q);
  for (let i=0;i<3;i++) { const c=numeric(ax[i],by[i]); if(c) return c; }
  if (!x.prerelease.length || !y.prerelease.length) return cmp(!x.prerelease.length,!y.prerelease.length);
  for (let i=0;i<Math.min(x.prerelease.length,y.prerelease.length);i++) {
    const p=x.prerelease[i],q=y.prerelease[i], pn=/^\d+$/.test(p),qn=/^\d+$/.test(q);
    const c=pn && qn ? numeric(p,q) : pn !== qn ? (pn ? -1 : 1) : cmp(p,q);
    if(c) return c;
  }
  return cmp(x.prerelease.length,y.prerelease.length);
}
