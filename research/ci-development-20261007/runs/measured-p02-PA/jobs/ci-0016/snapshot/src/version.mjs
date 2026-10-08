const pattern = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*))?$/;
export function parseVersion(text) {
  if (typeof text !== 'string') throw Error('invalid version');
  const match = pattern.exec(text);
  if (!match) throw Error('invalid version');
  const prerelease = match[4]?.split('.') ?? [];
  if (prerelease.some(p => /^\d+$/.test(p) && p.length > 1 && p[0] === '0')) throw Error('invalid version');
  return {major:Number(match[1]),minor:Number(match[2]),patch:Number(match[3]),prerelease};
}
export function compareVersions(a,b) {
  parseVersion(a); parseVersion(b);
  const split = v => { const m = pattern.exec(v); return [m.slice(1,4),m[4]?.split('.') ?? []]; };
  const [ac,ap] = split(a), [bc,bp] = split(b);
  const cmp = (x,y) => x < y ? -1 : x > y ? 1 : 0;
  for (let i=0;i<3;i++) { const c=cmp(BigInt(ac[i]),BigInt(bc[i])); if(c) return c; }
  if (!ap.length || !bp.length) return cmp(Boolean(bp.length),Boolean(ap.length));
  for(let i=0;i<Math.min(ap.length,bp.length);i++) {
    const an=/^\d+$/.test(ap[i]), bn=/^\d+$/.test(bp[i]);
    const c=an && bn ? cmp(BigInt(ap[i]),BigInt(bp[i])) : an !== bn ? (an ? -1 : 1) : cmp(ap[i],bp[i]);
    if(c) return c;
  }
  return cmp(ap.length,bp.length);
}
