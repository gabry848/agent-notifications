import { retryDelay } from './retry.mjs';
export function createHttpSender({ fetchImpl, loadCurrentPolicy, wait, maxAttempts = 3 }) {
  if (typeof fetchImpl !== 'function' || typeof loadCurrentPolicy !== 'function' || typeof wait !== 'function' || !Number.isInteger(maxAttempts) || maxAttempts <= 0) throw new TypeError('Invalid sender options');
  return async function send(delivery) {
    const body = JSON.stringify(delivery.event);
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const response = await fetchImpl(delivery.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
      if (response.ok) return response.json();
      if (!(response.status === 429 || (response.status >= 500 && response.status <= 599)) || attempt === maxAttempts - 1) throw new Error(`HTTP ${response.status}`);
      const policy = await loadCurrentPolicy();
      const raw = response.headers.get('retry-after');
      const seconds = typeof raw === 'string' && /^\d+(?:\.\d+)?$/.test(raw.trim()) ? Number(raw) : 0;
      const retryAfterMs = Number.isFinite(seconds * 1000) ? seconds * 1000 : 0;
      // Policies may cap below the fixed 100ms base; apply that cap after computing.
      const delay = retryDelay(attempt, { baseMs: 100, capMs: Math.max(100, policy.retryCapMs), retryAfterMs });
      await wait(Math.min(policy.retryCapMs, delay));
    }
  };
}
