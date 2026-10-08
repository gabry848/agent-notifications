export function parseVersion(text) {
  if (typeof text !== 'string') throw Error('invalid version');
  const match = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(text);
  if (!match) throw Error('invalid version');
  const prerelease = match[4] ? match[4].split('.') : [];
  if (prerelease.some(s => /^[0-9]+$/.test(s) && s.length > 1 && s[0] === '0')) throw Error('invalid version');
  return {major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), prerelease};
}
const cmp = (a,b) => a < b ? -1 : a > b ? 1 : 0;
export function compareVersions(a,b) {
  parseVersion(a); parseVersion(b);
  // Compare integer text without precision loss, including very large components.
  const parts = s => { const i = s.indexOf('-'); return [ (i < 0 ? s : s.slice(0,i)).split('.'), i < 0 ? [] : s.slice(i+1).split('.') ]; };
  const integerCompare = (x,y) => cmp(x.length,y.length) || cmp(x,y);
  const [av,ap] = parts(a), [bv,bp] = parts(b);
  for (let i=0;i<3;i++) { const c=integerCompare(av[i],bv[i]); if(c) return c; }
  if (!ap.length || !bp.length) return cmp(Boolean(bp.length),Boolean(ap.length));
  for(let i=0;i<Math.min(ap.length,bp.length);i++) {
    const x=ap[i], y=bp[i], xn=/^[0-9]+$/.test(x), yn=/^[0-9]+$/.test(y);
    const c=xn && yn ? integerCompare(x,y) : xn !== yn ? (xn ? -1 : 1) : cmp(x,y);
    if(c) return c;
  }
  return cmp(ap.length,bp.length);
}
