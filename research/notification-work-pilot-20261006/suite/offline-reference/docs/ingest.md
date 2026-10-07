Implement pure functions without dependencies. Never mutate caller inputs.
parseEvent(raw): raw is a JSON string or object. Return exactly producer, entityId, topic, revision, occurredAt, body. First three fields must be nonempty strings, revision a nonnegative integer, occurredAt an ISO date parseable by Date.parse, body a non-null non-array object. Throw on invalid input; omit unknown fields and clone body recursively.
eventKey(event): collision-free JSON.stringify([producer, entityId, revision]); revision zero is valid.
normalizeSubscriptions(items): require nonempty sessionId and array of nonempty topic strings; default active=true unless active is false. Merge repeated sessionId records by union of topics, OR of active; sort sessions and each topic list lexicographically. Do not mutate inputs.
recipientsFor(event, subscriptions): return sorted unique active session IDs with '*' or exact matching topic. Input may be unnormalized; normalize internally.
newestByEntity(events): retain greatest revision per producer/entityId, prefer latest occurredAt on equal revision, first occurrence if timestamps tie. Output sorted by producer then entityId; clone returned events.
routeBatch(events, subscriptions): reduce newestByEntity; emit {target,event} for each recipient, in entity output order then sorted target order; no recipients means no delivery.
