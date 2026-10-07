function validateTime(now) {
  if (!Number.isFinite(now) || now < 0) throw new TypeError('Time must be a nonnegative finite number');
}

function compareIds(a, b) {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function retryDelay(attempts, baseMs = 100, capMs = 10000) {
  if (!Number.isInteger(attempts) || attempts <= 0) throw new TypeError('Attempts must be a positive integer');
  if (!Number.isFinite(baseMs) || baseMs <= 0 || !Number.isFinite(capMs) || capMs <= 0) {
    throw new TypeError('Base and cap must be positive finite numbers');
  }
  let delay = Math.min(baseMs, capMs);
  let remaining = attempts - 1;
  // Scale in finite chunks: even subnormal bases can grow beyond exponent 1023.
  while (remaining > 0 && delay < capMs) {
    const step = Math.min(remaining, 1023);
    delay = Math.min(capMs, delay * 2 ** step);
    remaining -= step;
  }
  return delay;
}

export function initialDelivery(eventKey, target, now) {
  if (typeof eventKey !== 'string' || eventKey.length === 0 || typeof target !== 'string' || target.length === 0) {
    throw new TypeError('Event key and target must be nonempty strings');
  }
  validateTime(now);
  return { id: JSON.stringify([eventKey, target]), eventKey, target, status: 'pending', attempts: 0, availableAt: now, updatedAt: now };
}

export function transitionDelivery(state, action, now) {
  validateTime(now);
  validateTime(state.updatedAt);
  if (now < state.updatedAt) throw new RangeError('Time cannot precede the last update');
  const next = structuredClone(state);
  switch (action) {
    case 'attempt':
      if (state.status !== 'pending' && state.status !== 'retry') throw new Error('Cannot attempt delivery');
      next.status = 'sending';
      next.attempts = state.attempts + 1;
      break;
    case 'delivered':
      if (state.status !== 'sending') throw new Error('Cannot deliver');
      next.status = 'delivered';
      break;
    case 'failed':
      if (state.status !== 'sending') throw new Error('Cannot fail delivery');
      next.status = 'retry';
      next.availableAt = now + retryDelay(state.attempts);
      break;
    case 'ack':
      if (state.status !== 'delivered' && state.status !== 'acked') throw new Error('Cannot acknowledge delivery');
      next.status = 'acked';
      break;
    default:
      throw new Error('Unknown delivery action');
  }
  next.updatedAt = now;
  return next;
}

export function dueDeliveries(states, now) {
  validateTime(now);
  return states
    .filter(state => (state.status === 'pending' || state.status === 'retry') && state.availableAt <= now)
    .map(state => structuredClone(state))
    .sort((a, b) => a.availableAt - b.availableAt || compareIds(a, b));
}

export function summarizeQueue(states) {
  const counts = { pending: 0, sending: 0, retry: 0, delivered: 0, acked: 0, total: 0 };
  for (const state of states) {
    if (state.status === 'total' || !Object.hasOwn(counts, state.status)) throw new Error('Unknown delivery status');
    counts[state.status] += 1;
    counts.total += 1;
  }
  return counts;
}

export function mergeQueue(existing, incoming) {
  const byId = new Map();
  for (const state of [...existing, ...incoming]) {
    const previous = byId.get(state.id);
    if (!previous || state.updatedAt >= previous.updatedAt) byId.set(state.id, state);
  }
  return [...byId.values()].map(state => structuredClone(state)).sort(compareIds);
}
