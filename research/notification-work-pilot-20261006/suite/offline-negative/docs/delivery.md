Implement pure functions without dependencies. Never mutate caller inputs.
retryDelay(attempts, baseMs=100, capMs=10000): attempts must be a positive integer; base/cap positive finite numbers. Return min(capMs, baseMs * 2**(attempts-1)), including very large attempts without overflow.
initialDelivery(eventKey, target, now): eventKey/target nonempty strings and now finite number >=0. Return {id:JSON.stringify([eventKey,target]),eventKey,target,status:'pending',attempts:0,availableAt:now,updatedAt:now}.
transitionDelivery(state, action, now): immutable state transitions: attempt from pending/retry -> sending and attempts+1; delivered from sending -> delivered; failed from sending -> retry and availableAt=now+retryDelay(attempts); ack from delivered/acked -> acked. updatedAt=now for any valid action; never change other fields. Throw on invalid transition, invalid action/time, or time before state's updatedAt.
dueDeliveries(states, now): copy pending/retry items with availableAt<=now, ordered by availableAt then id lexicographically.
summarizeQueue(states): return counts for exactly pending,sending,retry,delivered,acked plus total; throw for unknown statuses.
mergeQueue(existing, incoming): IDs are immutable identifiers. Merge by id, greatest updatedAt wins; ties prefer incoming, preserving no references to caller nested objects. Sort output by id.
