export function parseVersion(text) {
  if (typeof text !== 'string' || !/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*))?$/.test(text)) throw Error('Invalid version');
  const match = text.match(/^(\d+)\.(\d+)\.(\d+)(?:-(.*))?$/);
  const prerelease = match[4] ? match[4].split('.') : [];
  if (prerelease.some(p => /^\d+$/.test(p) && p.length > 1 && p[0] === '0')) throw Error('Invalid version');
  return {major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), prerelease};
}
export function compareVersions(a, b) {
  const left = parseVersion(a), right = parseVersion(b);
  // Compare the original integer strings to avoid precision loss for large versions.
  const integerCompare = (x, y) => x.length === y.length ? (x === y ? 0 : x < y ? -1 : 1) : x.length < y.length ? -1 : 1;
  const aa = a.split('-')[0].split('.'), bb = b.split('-')[0].split('.');
  for (let i = 0; i < 3; i++) { const c = integerCompare(aa[i], bb[i]); if (c) return c; }
  const ap = left.prerelease, bp = right.prerelease;
  if (!ap.length || !bp.length) return ap.length === bp.length ? 0 : ap.length ? -1 : 1;
  for (let i = 0; i < Math.min(ap.length, bp.length); i++) {
    const x = ap[i], y = bp[i]; if (x === y) continue;
    const xn = /^\d+$/.test(x), yn = /^\d+$/.test(y);
    return xn && yn ? integerCompare(x, y) : xn !== yn ? xn ? -1 : 1 : x < y ? -1 : 1;
  }
  return ap.length === bp.length ? 0 : ap.length < bp.length ? -1 : 1;
}
