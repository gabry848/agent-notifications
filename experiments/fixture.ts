import { Type } from '@earendil-works/pi-ai';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export default function fixture(pi: ExtensionAPI) {
  let stage = 0;
  const gates = JSON.parse(process.env.PI_LAB_GATES ?? '[]') as number[];
  const trace = (type: string, data: object = {}) => appendFileSync(process.env.PI_NOTIFY_TRACE!,
    JSON.stringify({ time: new Date().toISOString(), type, ...data }) + '\n');
  pi.registerTool({
    name: 'lab_step', label: 'Read source snapshot',
    description: 'Read one of the three local deployment source snapshots sequentially, stage 1 then 2 then 3.',
    parameters: Type.Object({ stage: Type.Integer({ minimum: 1, maximum: 3 }) }),
    async execute(_id, params, signal) {
      if (params.stage !== stage + 1) throw new Error(`Next stage must be ${stage + 1}`);
      stage = params.stage;
      if (gates.includes(stage)) {
        await new Promise<void>((resolve, reject) => {
          let timer: ReturnType<typeof setTimeout>;
          const cleanup = () => { unsubscribe(); clearTimeout(timer); signal?.removeEventListener('abort', abort); };
          const unsubscribe = pi.events.on('notification-lab:release', data => {
            if ((data as { stage: number }).stage === stage) { cleanup(); resolve(); }
          });
          const abort = () => { cleanup(); reject(new Error('Lab gate aborted')); };
          timer = setTimeout(() => { cleanup(); reject(new Error('Lab gate timed out')); }, 60000);
          signal?.addEventListener('abort', abort, { once: true });
          if (signal?.aborted) return abort();
          trace('lab_gate', { stage });
        });
      }
      const result = [
        { service: 'invoice-service', region: 'eu-west-1', release: 'v1.4', maxBatch: 50 },
        { codeReview: 'passed', unitTests: 'passed' },
        { configurationReview: 'passed', dependencies: 'available' },
      ][stage - 1];
      trace('lab_step_completed', { stage, result });
      return { content: [{ type: 'text', text: JSON.stringify(result) }], details: result };
    },
  });
  pi.registerTool({
    name: 'lab_submit', label: 'Save deployment plan',
    description: 'Save the final deployment plan to result.json after reading all three source snapshots.',
    parameters: Type.Object({ region: Type.String(), release: Type.String(), maxBatch: Type.Integer(),
      status: Type.Union([Type.Literal('ready'), Type.Literal('blocked')]), notes: Type.String() }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      if (stage !== 3) throw new Error('Read all three source snapshots first');
      writeFileSync(join(ctx.cwd, 'result.json'), JSON.stringify(params, null, 2) + '\n');
      trace('lab_submit', { result: params });
      return { content: [{ type: 'text', text: 'Deployment plan saved locally to result.json.' }], details: params };
    },
  });
}
