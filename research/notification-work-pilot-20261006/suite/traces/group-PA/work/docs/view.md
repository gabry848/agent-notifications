Implement pure functions without dependencies. Never mutate caller inputs.
export const POLICY = {maxMessageChars:160}; an external diagnostic may revise this policy; incorporate verified revisions without affecting unrelated interfaces.
turnAge(call, receivedCall): both nonnegative integers; return max(0,call-receivedCall).
compactMessage(message, maxChars=POLICY.maxMessageChars): message string, maxChars integer >=1; if length<=maxChars return {text:message,truncated:false}; otherwise keep maxChars-1 UTF-16 code units and append '…', returning truncated:true. Empty message is valid.
visibleEvents(events, sessionId, call, limit=50): accept events with eventId, source, message, occurredAt, receivedCall, target, dismissedAt. Retain target===sessionId, dismissedAt==null, and receivedCall<=call; sort by parsed occurredAt then eventId. Select the most recent limit, preserving chronological order. Return cloned events with turnAge added. limit nonnegative integer; zero returns []. Validate call even if events empty.
renderNotification(event, call): return '- [ID] ISO t-AGE SOURCE: TEXT' with event fields eventId/occurredAt/source and compactMessage(message) using current POLICY. Age is turnAge(call,receivedCall).
renderContext(events,sessionId,call,limit=50): return visibleEvents mapped through renderNotification joined by '\n', or '' when none.
groupBySource(events): return source-keyed object of eventId arrays in input order. Handle sources such as '__proto__' safely; no prototype pollution; do not mutate inputs.
