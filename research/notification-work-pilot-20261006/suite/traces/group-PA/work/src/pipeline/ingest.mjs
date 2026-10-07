const nonemptyString = value => typeof value === 'string' && value.length > 0;
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const isoDate = /^(?:\d{4}|[+-]\d{6})-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?)?$/;

export function parseEvent(raw) {
  const event = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    throw new TypeError('Event must be an object');
  }
  const { producer, entityId, topic, revision, occurredAt, body } = event;
  if (![producer, entityId, topic].every(nonemptyString)
      || !Number.isInteger(revision) || revision < 0
      || typeof occurredAt !== 'string' || !isoDate.test(occurredAt)
      || !Number.isFinite(Date.parse(occurredAt))
      || !body || typeof body !== 'object' || Array.isArray(body)) {
    throw new TypeError('Invalid event fields');
  }
  return { producer, entityId, topic, revision, occurredAt, body: structuredClone(body) };
}

export function eventKey(event) {
  return JSON.stringify([event.producer, event.entityId, event.revision]);
}

export function normalizeSubscriptions(items) {
  if (!Array.isArray(items)) throw new TypeError('Subscriptions must be an array');
  const sessions = new Map();
  for (const item of items) {
    if (!item || !nonemptyString(item.sessionId) || !Array.isArray(item.topics)
        || !Array.from(item.topics).every(nonemptyString)) {
      throw new TypeError('Invalid subscription');
    }
    let session = sessions.get(item.sessionId);
    if (!session) {
      session = { sessionId: item.sessionId, topics: new Set(), active: false };
      sessions.set(item.sessionId, session);
    }
    for (const topic of item.topics) session.topics.add(topic);
    session.active ||= item.active !== false;
  }
  return [...sessions.values()]
    .sort((a, b) => compare(a.sessionId, b.sessionId))
    .map(({ sessionId, topics, active }) => ({ sessionId, topics: [...topics].sort(compare), active }));
}

export function recipientsFor(event, subscriptions) {
  return normalizeSubscriptions(subscriptions)
    .filter(({ active, topics }) => active && (topics.includes('*') || topics.includes(event.topic)))
    .map(({ sessionId }) => sessionId);
}

export function newestByEntity(events) {
  const newest = new Map();
  for (const event of events) {
    const key = JSON.stringify([event.producer, event.entityId]);
    const previous = newest.get(key);
    if (!previous || event.revision > previous.revision
        || (event.revision === previous.revision
            && Date.parse(event.occurredAt) > Date.parse(previous.occurredAt))) {
      newest.set(key, event);
    }
  }
  return [...newest.values()]
    .sort((a, b) => compare(a.producer, b.producer) || compare(a.entityId, b.entityId))
    .map(event => structuredClone(event));
}

export function routeBatch(events, subscriptions) {
  const normalized = normalizeSubscriptions(subscriptions);
  return newestByEntity(events).flatMap(event => recipientsFor(event, normalized)
    .map(target => ({ target, event: structuredClone(event) })));
}
