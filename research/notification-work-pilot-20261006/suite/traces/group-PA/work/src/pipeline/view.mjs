export const POLICY = {maxMessageChars:192};

function nonnegativeInteger(value, name) {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a nonnegative integer`);
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
    throw new RangeError('maxChars must be a positive integer');
  }
  return message.length <= maxChars
    ? {text: message, truncated: false}
    : {text: message.slice(0, maxChars - 1) + '…', truncated: true};
}

export function visibleEvents(events, sessionId, call, limit = 50) {
  nonnegativeInteger(call, 'call');
  nonnegativeInteger(limit, 'limit');
  if (limit === 0) return [];
  return events
    .filter(event => event.target === sessionId && event.dismissedAt == null && event.receivedCall <= call)
    .sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt)
      || (a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0))
    .slice(-limit)
    .map(event => ({...event, turnAge: turnAge(call, event.receivedCall)}));
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
  const groups = {};
  for (const {source, eventId} of events) {
    if (!Object.hasOwn(groups, source)) {
      Object.defineProperty(groups, source, {
        value: [], enumerable: true, writable: true, configurable: true,
      });
    }
    groups[source].push(eventId);
  }
  return groups;
}
