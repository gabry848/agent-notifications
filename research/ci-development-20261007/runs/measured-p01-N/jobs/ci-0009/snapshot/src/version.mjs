const pattern = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*))?$/;
export function parseVersion(text) {
  if (typeof text !== 'string') throw Error('invalid version');
  const match = pattern.exec(text);
  if (!match) throw Error('invalid version');
  const prerelease = match[4] ? match[4].split('.') : [];
  if (prerelease.some(p => /^0[0-9]+$/.test(p))) throw Error('invalid version');
  return {major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), prerelease};
}
const cmp = (a,b) => a === b ? 0 : a < b ? -1 : 1;
export function compareVersions(a,b) {
  const x = parseVersion(a), y = parseVersion(b);
  // Compare original integer strings so even very large components remain exact.
  const xb = a.split('-')[0].split('.'), yb = b.split('-')[0].split('.');
  const numeric = (a,b) => cmp(a.length,b.length) || cmp(a,b);
  for (let i=0;i<3;i++) { const c=numeric(xb[i],yb[i]); if(c) return c; }
  if (!x.prerelease.length || !y.prerelease.length) return cmp(!!y.prerelease.length, !!x.prerelease.length);
  for (let i=0;i<Math.min(x.prerelease.length,y.prerelease.length);i++) {
    const p=x.prerelease[i], q=y.prerelease[i], pn=/^[0-9]+$/.test(p), qn=/^[0-9]+$/.test(q);
    const c=pn && qn ? numeric(p,q) : pn !== qn ? (pn ? -1 : 1) : cmp(p,q);
    if(c) return c;
  }
  return cmp(x.prerelease.length,y.prerelease.length);
}
