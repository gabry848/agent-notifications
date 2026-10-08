export function parseVersion(text) {
  if (typeof text !== 'string') throw new Error('Invalid version');
  const match = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(text);
  if (!match) throw new Error(`Invalid version: ${text}`);
  const prerelease = match[4] ? match[4].split('.') : [];
  if (prerelease.some(p => /^[0-9]+$/.test(p) && p.length > 1 && p[0] === '0')) throw new Error('Invalid numeric prerelease');
  return {major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), prerelease};
}
const cmp = (a, b) => a < b ? -1 : a > b ? 1 : 0;
export function compareVersions(a, b) {
  const av = parseVersion(a), bv = parseVersion(b);
  // Compare original integer strings so even components beyond Number's precision sort correctly.
  const ac = a.split('-')[0].split('.'), bc = b.split('-')[0].split('.');
  for (let i = 0; i < 3; i++) {
    const result = cmp(BigInt(ac[i]), BigInt(bc[i]));
    if (result) return result;
  }
  if (!av.prerelease.length || !bv.prerelease.length) return cmp(!av.prerelease.length, !bv.prerelease.length);
  for (let i = 0; i < Math.min(av.prerelease.length, bv.prerelease.length); i++) {
    const x = av.prerelease[i], y = bv.prerelease[i];
    const xn = /^[0-9]+$/.test(x), yn = /^[0-9]+$/.test(y);
    const result = xn && yn ? cmp(BigInt(x), BigInt(y)) : xn !== yn ? (xn ? -1 : 1) : cmp(x, y);
    if (result) return result;
  }
  return cmp(av.prerelease.length, bv.prerelease.length);
}
