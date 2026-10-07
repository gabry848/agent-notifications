export const MODES = ['N', 'P10', 'PA', 'W'];
export const SCENARIOS = ['S1','S2','S3','S4','S5','S6'];
export function scenario(name, seed = 1) {
  const batch = 10 + seed % 31;
  const job = (id, durationMs, status = 'succeeded', extra = {}) => ({ id, durationMs, status, result: { maxBatch: batch, release: 'v1.4', region: 'eu-west-1', ...extra } });
  const common = { name, seed, batch, independent: ['S3','S4','S5','S6'].includes(name),
    expected: { region: 'eu-west-1', release: 'v1.4', maxBatch: batch, status: 'ready' }, jobs: [] };
  switch (name) {
    case 'S1': return { ...common, jobs: [job('validation', 2000)] };
    case 'S2': return { ...common, jobs: [job('validation', 90000)] };
    case 'S3': return { ...common, jobs: [job('validation', 20000)] };
    case 'S4': return { ...common, jobs: [job('a',60000),job('b',10000),job('c',40000),job('d',20000,'failed'),job('e',50000),job('f',30000)],
      expected: { ...common.expected, status: 'blocked' } };
    case 'S5': return { ...common, jobs: [job('validation',10000,'failed',{ revoked: true })], expected: { ...common.expected, status: 'blocked' } };
    case 'S6': return { ...common, jobs: [job('validation',10000,'succeeded',{ diagnostic: 'Workload diagnostic record. '.repeat(285) })], noise: 19 };
    case 'unsolicited': return { ...common, independent: true, unsolicited: true, jobs: [job('validation',3000)] };
    case 'hostile': return { ...common, jobs: [job('validation',2000)], hostile: true };
    case 'duplicate': return { ...common, jobs: [job('validation',2000)], duplicate: true };
    default: throw new Error(`Unknown scenario: ${name}`);
  }
}
export const policy = mode => ({
  N: 'Use relevant runtime notifications when present. Do not query job status to check arrivals. If no independent work remains and a required result is still unavailable, await_jobs is allowed. Do not fabricate results.',
  P10: 'Acquire job results with get_job. While jobs are pending, perform available independent work; between consecutive pending checks wait at least 10 seconds using pause. Aggregate all IDs in each check. Do not use await_jobs in this polling mode.',
  PA: 'Acquire job results with get_job. While jobs are pending, perform independent work. Between pending checks use pause with intervals 2,4,8,16,30 seconds, then 30 seconds repeatedly. Aggregate all IDs. Do not use await_jobs in this polling mode.',
  W: 'Acquire final results using await_jobs, aggregating all IDs in one call. Complete independent work first when useful. Do not repeatedly query job status.',
}[mode]);
export function task(spec, mode) {
  return `Prepare a verified local deployment plan. Region must remain eu-west-1 and release v1.4.
${spec.unsolicited ? 'A background producer is already running. Do not call any MCP job tool in this case.' : 'Call start_job once with ids=' + JSON.stringify(spec.jobs.map(j=>j.id)) + ' to start validation. Results and durations are unknown until acquired.'}
${spec.independent ? 'Independent work: read modules in fixture/, replace each TODO implementation so transform(n) returns n * FACTOR + OFFSET from that module. These edits do not depend on validation; run verify_files before final submission.' : 'There is no independent work and no module edits are required.'}
Use every required validation result, retaining its maxBatch. Mark status blocked if any job failed or release was revoked; otherwise ready. Never deploy or contact other services.
${spec.unsolicited ? 'Do not call MCP job tools. Use relevant runtime facts when available. If a required fact is unavailable after the independent work, state that limitation and do not guess or submit an unverified plan.' : policy(mode)}
When all required final results are known, save the plan with submit_plan, including region, release, maxBatch, status, and jobIds. Do not include irrelevant cafeteria events in the plan. Briefly explain the outcome.`;
}
