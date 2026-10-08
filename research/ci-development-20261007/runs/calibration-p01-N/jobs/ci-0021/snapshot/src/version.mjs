export function parseVersion(text) {
  if (typeof text !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*))?$/.test(text)) throw Error('invalid version');
  const match = text.match(/^(\d+)\.(\d+)\.(\d+)(?:-(.*))?$/);
  const prerelease = match[4] ? match[4].split('.') : [];
  if (prerelease.some(p => /^\d+$/.test(p) && p.length > 1 && p[0] === '0')) throw Error('invalid version');
  return {major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), prerelease};
}
const cmp = (a,b) => a < b ? -1 : a > b ? 1 : 0;
export function compareVersions(a,b) {
  const x = parseVersion(a), y = parseVersion(b);
  // Compare the original integer components exactly, even beyond Number's safe range.
  const ax = a.split('-')[0].split('.'), by = b.split('-')[0].split('.');
  for (let i=0;i<3;i++) { const c=cmp(BigInt(ax[i]),BigInt(by[i])); if(c) return c; }
  if (!x.prerelease.length || !y.prerelease.length) return cmp(!x.prerelease.length, !y.prerelease.length);
  for(let i=0;i<Math.min(x.prerelease.length,y.prerelease.length);i++) {
    const p=x.prerelease[i], q=y.prerelease[i], pn=/^\d+$/.test(p), qn=/^\d+$/.test(q);
    const c=pn && qn ? cmp(BigInt(p),BigInt(q)) : pn !== qn ? (pn ? -1 : 1) : cmp(p,q);
    if(c) return c;
  }
  return cmp(x.prerelease.length,y.prerelease.length);
}
