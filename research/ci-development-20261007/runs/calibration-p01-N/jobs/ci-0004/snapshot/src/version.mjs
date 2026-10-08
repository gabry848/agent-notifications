export function parseVersion(text) {
  const [base,pre]=text.split('-'); const [major,minor,patch]=base.split('.').map(Number);
  if ([major,minor,patch].some(n=>!Number.isInteger(n)||n<0)) throw Error('invalid version');
  return {major,minor,patch,prerelease:pre?pre.split('.'):[]};
}
export function compareVersions(a,b) { return a===b?0:a<b?-1:1; }
