const pattern = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*))?$/;
export function parseVersion(text) {
  const match = typeof text === 'string' && pattern.exec(text);
  if (!match || match[0] !== text) throw new Error('Invalid version');
  const prerelease = match[4] ? match[4].split('.') : [];
  if (prerelease.some(p => /^\d+$/.test(p) && p.length > 1 && p[0] === '0')) throw new Error('Invalid prerelease version');
  return {major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), prerelease};
}
const cmp = (a, b) => a < b ? -1 : a > b ? 1 : 0;
export function compareVersions(a, b) {
  const av = parseVersion(a), bv = parseVersion(b);
  const ab = a.split('-')[0].split('.'), bb = b.split('-')[0].split('.');
  for (let i = 0; i < 3; i++) { const n = cmp(BigInt(ab[i]), BigInt(bb[i])); if (n) return n; }
  if (!av.prerelease.length || !bv.prerelease.length) return cmp(!av.prerelease.length, !bv.prerelease.length);
  for (let i = 0; i < Math.min(av.prerelease.length, bv.prerelease.length); i++) {
    const x = av.prerelease[i], y = bv.prerelease[i], xn = /^\d+$/.test(x), yn = /^\d+$/.test(y);
    const n = xn && yn ? cmp(BigInt(x), BigInt(y)) : xn !== yn ? (xn ? -1 : 1) : cmp(x, y);
    if (n) return n;
  }
  return cmp(av.prerelease.length, bv.prerelease.length);
}
