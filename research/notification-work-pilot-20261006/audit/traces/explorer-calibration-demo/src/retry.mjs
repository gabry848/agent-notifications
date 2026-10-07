export function retryDelay(attempt, options) {
  const { baseMs, capMs, retryAfterMs = 0 } = options ?? {};
  if (!Number.isInteger(attempt) || attempt < 0 || !Number.isFinite(baseMs) || baseMs <= 0 || !Number.isFinite(capMs) || capMs < baseMs || !Number.isFinite(retryAfterMs) || retryAfterMs < 0) throw new TypeError('Invalid retry options');
  const exponential = attempt >= Math.log2(capMs / baseMs) ? capMs : baseMs * 2 ** attempt;
  return Math.min(capMs, Math.max(exponential, retryAfterMs));
}
