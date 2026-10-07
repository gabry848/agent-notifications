export function validPattern(pattern) {
  if (typeof pattern !== 'string') return false;
  const tokens = pattern.split('.');
  return tokens.every((token, i) => token.length > 0 && (token !== '**' || i === tokens.length - 1));
}

export function matchesTopic(pattern, topic) {
  if (!validPattern(pattern) || typeof topic !== 'string') return false;
  const p = pattern.split('.'), t = topic.split('.');
  if (t.some(token => !token || token === '**')) return false;
  for (let i = 0; i < p.length; i++) {
    if (p[i] === '**') return true;
    if (i >= t.length || (p[i] !== '*' && p[i] !== t[i])) return false;
  }
  return p.length === t.length;
}
