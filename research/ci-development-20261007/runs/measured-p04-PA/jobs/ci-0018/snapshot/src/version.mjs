export function parseVersion(text) {
  if (typeof text !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*))?$/.test(text)) throw Error('invalid version');
  const [base, pre] = text.split(/-(.*)/s);
  const [major, minor, patch] = base.split('.').map(Number);
  const prerelease = pre ? pre.split('.') : [];
  if (prerelease.some(p => /^\d+$/.test(p) && p.length > 1 && p[0] === '0')) throw Error('invalid version');
  return {major, minor, patch, prerelease};
}
const cmp = (a,b) => a < b ? -1 : a > b ? 1 : 0;
export function compareVersions(a,b) {
  const x = parseVersion(a), y = parseVersion(b);
  // Compare the original integer strings, so arbitrarily large components stay exact.
  const xb = a.split('-')[0].split('.'), yb = b.split('-')[0].split('.');
  for (let i = 0; i < 3; i++) { const c = cmp(BigInt(xb[i]), BigInt(yb[i])); if (c) return c; }
  if (!x.prerelease.length || !y.prerelease.length) return cmp(!x.prerelease.length, !y.prerelease.length);
  for (let i = 0; i < Math.min(x.prerelease.length,y.prerelease.length); i++) {
    const p = x.prerelease[i], q = y.prerelease[i];
    const pn = /^\d+$/.test(p), qn = /^\d+$/.test(q);
    const c = pn && qn ? cmp(BigInt(p),BigInt(q)) : pn !== qn ? (pn ? -1 : 1) : cmp(p,q);
    if (c) return c;
  }
  return cmp(x.prerelease.length,y.prerelease.length);
}
