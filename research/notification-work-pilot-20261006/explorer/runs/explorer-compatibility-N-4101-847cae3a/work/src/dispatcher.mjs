export async function deliverAll(deliveries, send, { concurrency } = {}) {
  if (!Number.isInteger(concurrency) || concurrency <= 0) throw new TypeError('Invalid concurrency');
  const results = new Array(deliveries.length);
  let next = 0;
  async function worker() {
    while (next < deliveries.length) {
      const index = next++;
      try { results[index] = { ok: true, value: await send(deliveries[index]) }; }
      catch (error) { results[index] = { ok: false, error: error instanceof Error ? error.message : String(error) }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, deliveries.length) }, worker));
  return results;
}
