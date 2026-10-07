import { OPEN_MARKER, CLOSE_MARKER } from '../src/store.mjs';

export function assess({ spec, result, error, trace, received, idleVerified, historyText, providerRecords }) {
  const snapshots = trace.filter(e => e.type === 'context_snapshot');
  const failures = [];
  if (error) failures.push(error);
  if (received.length !== spec.notifications.length) failures.push('Not all notifications were delivered');
  for (const n of received) {
    const arrival = trace.find(e => e.type === 'notification_received' && e.notification.id === n.id);
    const first = snapshots.find(e => e.call > arrival?.lastContextCall);
    if (!first?.active.some(a => a.id === n.id && a.turnAge === 0)) failures.push(`Missing at next call: ${n.id}`);
  }
  const providerChecks = providerRecords.map(p => {
    const strings = [];
    const visit = value => {
      if (typeof value === 'string') strings.push(value);
      else if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') Object.values(value).forEach(visit);
    };
    visit(p.payload);
    const blocks = strings.filter(text => text.startsWith(OPEN_MARKER + '\n## Notifications'));
    const body = blocks.join('\n');
    const snapshot = snapshots.find(s => s.call === p.call);
    const closes = body.split(CLOSE_MARKER).length - 1;
    return { call: p.call, attempt: p.attempt, exactlyOneBlock: blocks.length === 1 && closes === 1,
      allActivePresent: snapshot?.active.every(n => body.includes(n.id)) ?? false,
      activeCount: snapshot?.active.length ?? 0 };
  });
  if (!providerChecks.length || providerChecks.some(c => !c.exactlyOneBlock || !c.allActivePresent)) failures.push('Provider payload block verification failed');
  if (spec.timing === 'idle' && !idleVerified) failures.push('Idle notification started a provider request');
  const mismatches = Object.entries(spec.expected).filter(([key, value]) => result?.[key] !== value).map(([key, value]) => `${key}: expected ${value}, got ${result?.[key]}`);
  const dismisses = trace.filter(e => e.type === 'notification_dismissed' && e.dismissed);
  let historyPass = null;
  if (spec.historyFollowup) {
    const history = trace.filter(e => e.type === 'notification_history').at(-1)?.notifications ?? [];
    historyPass = received.every(n => history.some(h => h.id === n.id && h.dismissedAt)) &&
      historyText.includes(`RN-${spec.notifications[0].message.match(/RN-(\d+)/)?.[1]}`) && historyText.includes(String(spec.batch));
  }
  const exposure = received.map(n => {
    const ages = snapshots.flatMap(s => s.active.filter(a => a.id === n.id).map(a => ({ call: s.call, age: a.turnAge })));
    return { id: n.id, ages, dismissed: dismisses.some(d => d.id === n.id) };
  });
  return { injectionPass: !failures.length, injectionFailures: failures, providerChecks,
    behaviorPass: !error && !mismatches.length && historyPass !== false, behaviorMismatches: mismatches,
    historyPass, exposure, lifecycleExplicitlyRequested: !!spec.historyFollowup };
}
