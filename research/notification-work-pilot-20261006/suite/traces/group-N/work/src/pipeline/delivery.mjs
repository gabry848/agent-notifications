const statuses = ['pending', 'sending', 'retry', 'delivered', 'acked'];

function validateTime(now) {
  if (!Number.isFinite(now) || now < 0) throw new TypeError('Time must be finite and nonnegative');
}

export function retryDelay(attempts, baseMs = 100, capMs = 10000) {
  if (!Number.isInteger(attempts) || attempts <= 0) throw new TypeError('Attempts must be a positive integer');
  if (!Number.isFinite(baseMs) || baseMs <= 0 || !Number.isFinite(capMs) || capMs <= 0) {
    throw new TypeError('Base and cap must be positive finite numbers');
  }
  let delay = baseMs;
  let exponent = attempts - 1;
  // Chunking avoids an overflowing power when a very small base still yields
  // a finite delay. Even huge exponents reach the finite cap in a few chunks.
  while (exponent > 0 && delay < capMs) {
    const chunk = Math.min(exponent, 1023);
    delay *= 2 ** chunk;
    exponent -= chunk;
  }
  return Math.min(capMs, delay);
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
  if (now < state.updatedAt) throw new RangeError('Time cannot precede updatedAt');
  let changes;
  if (action === 'attempt' && (state.status === 'pending' || state.status === 'retry')) {
    changes = { status: 'sending', attempts: state.attempts + 1 };
  } else if (action === 'delivered' && state.status === 'sending') {
    changes = { status: 'delivered' };
  } else if (action === 'failed' && state.status === 'sending') {
    changes = { status: 'retry', availableAt: now + retryDelay(state.attempts) };
  } else if (action === 'ack' && (state.status === 'delivered' || state.status === 'acked')) {
    changes = { status: 'acked' };
  } else {
    throw new Error('Invalid delivery transition');
  }
  return { ...structuredClone(state), ...changes, updatedAt: now };
}

function compareIds(a, b) {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
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
    if (!statuses.includes(state.status)) throw new Error('Unknown delivery status');
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
