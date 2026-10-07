// Verified suite-diagnostics policy revision 1.
export const POLICY = {maxMessageChars:192};

function nonnegativeInteger(value, name) {
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a nonnegative integer`);
  }
}

export function turnAge(call, receivedCall) {
  nonnegativeInteger(call, 'call');
  nonnegativeInteger(receivedCall, 'receivedCall');
  return Math.max(0, call - receivedCall);
}

export function compactMessage(message, maxChars = POLICY.maxMessageChars) {
  if (typeof message !== 'string') throw new TypeError('message must be a string');
  if (!Number.isInteger(maxChars) || maxChars < 1) {
    throw new TypeError('maxChars must be a positive integer');
  }
  if (message.length <= maxChars) return {text: message, truncated: false};
  return {text: message.slice(0, maxChars - 1) + '…', truncated: true};
}

export function visibleEvents(events, sessionId, call, limit = 50) {
  nonnegativeInteger(call, 'call');
  nonnegativeInteger(limit, 'limit');
  if (limit === 0) return [];
  const visible = events.filter(event =>
    event.target === sessionId && event.dismissedAt == null && event.receivedCall <= call
  ).sort((a, b) => {
    const time = Date.parse(a.occurredAt) - Date.parse(b.occurredAt);
    if (time !== 0) return time;
    return a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0;
  });
  return visible.slice(-limit).map(event => ({
    ...event, turnAge: turnAge(call, event.receivedCall)
  }));
}

export function renderNotification(event, call) {
  const age = turnAge(call, event.receivedCall);
  const {text} = compactMessage(event.message);
  return `- [${event.eventId}] ${event.occurredAt} t-${age} ${event.source}: ${text}`;
}

export function renderContext(events, sessionId, call, limit = 50) {
  return visibleEvents(events, sessionId, call, limit)
    .map(event => renderNotification(event, call)).join('\n');
}

export function groupBySource(events) {
  const groups = Object.create(null);
  for (const event of events) {
    if (!Object.hasOwn(groups, event.source)) groups[event.source] = [];
    groups[event.source].push(event.eventId);
  }
  return groups;
}
